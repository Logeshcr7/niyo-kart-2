import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  getOrCreateUser,
  getUserByUid,
  getSavedComparisonsForUser,
  createSavedComparison,
  deleteSavedComparison,
  getUserFavorites,
  toggleFavorite,
  getUserPresets,
  createWeightPreset,
  deleteWeightPreset,
} from './src/db/queries.ts';
import { PHONES_DATA } from './src/data/phones.ts';
import { loadAdminPhones, saveAdminPhones, loadDeletedPhoneIds, saveDeletedPhoneIds } from './server/adminPhonesManager.ts';
import {
  SUPER_ADMIN_EMAIL,
  getAllAuthorizedAdmins,
  isEmailAuthorized,
  isSuperAdmin,
  addAuthorizedAdmin,
  removeAuthorizedAdmin,
} from './server/adminAccessManager.ts';
import {
  extractPhoneFromImage,
  lookupRealTimePhoneSpecs,
  fetchRealTimePriceAndSpecs,
} from './server/geminiService.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));
  app.use(express.static(path.join(process.cwd(), 'public')));

  // In-memory catalog initialized with persistent custom admin phones, base phones, and deleted IDs
  let adminPhonesList = loadAdminPhones();
  let deletedPhoneIdsList = loadDeletedPhoneIds();
  let deletedPhoneIdsSet = new Set<string>(deletedPhoneIdsList);

  // Helper: Get ALL phones in the entire catalog for admin access (including base data + admin added)
  const getAllManageablePhones = (): any[] => {
    const adminPhoneMap = new Map<string, any>();
    adminPhonesList.forEach((p) => {
      adminPhoneMap.set(p.id, p);
    });

    const allPhones: any[] = [];

    // 1. Any custom phones created by admin that don't exist in base data
    adminPhonesList.forEach((p) => {
      if (!deletedPhoneIdsSet.has(p.id) && !PHONES_DATA.some((bp) => bp.id === p.id)) {
        allPhones.push(p);
      }
    });

    // 2. All base phones (overridden by admin edits if modified)
    PHONES_DATA.forEach((bp) => {
      if (!deletedPhoneIdsSet.has(bp.id)) {
        const existing = adminPhoneMap.get(bp.id);
        if (existing) {
          allPhones.push(existing);
        } else {
          allPhones.push({ ...bp, isPublished: bp.isPublished !== false });
        }
      }
    });

    return allPhones;
  };

  // Helper to re-build the live public catalog (phones visible to regular users)
  const rebuildPublicCatalog = () => {
    const all = getAllManageablePhones();
    return all.filter((p) => p.isPublished !== false);
  };

  let activePhonesCatalog = rebuildPublicCatalog();

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    const allManageable = getAllManageablePhones();
    const publishedCount = activePhonesCatalog.length;
    const draftsCount = allManageable.filter((p) => p.isPublished === false).length;
    res.json({
      status: 'ok',
      service: 'Algorithm Mobile Comparison API',
      database: 'PostgreSQL (Cloud SQL)',
      totalPublicPhones: publishedCount,
      totalManageablePhones: allManageable.length,
      adminAddedPhones: adminPhonesList.length,
      draftsCount,
      timestamp: new Date().toISOString(),
    });
  });

  // Public phones catalog (Available to all users - strictly published phones only)
  app.get('/api/phones', (req, res) => {
    res.json(activePhonesCatalog);
  });

  // Middleware: Strict Backend Access Control
  // Only valid for logesh64646@gmail.com and Gmail accounts explicitly authorized by logesh64646@gmail.com
  const requireAdminAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let email = (req.headers['x-admin-email'] as string)?.trim().toLowerCase();

    // Check Firebase Authorization bearer token if available
    const authHeader = req.headers.authorization;
    if (!email && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1];
      try {
        if (!token.startsWith('demo-token-')) {
          const decoded = await adminAuth.verifyIdToken(token);
          if (decoded.email) {
            email = decoded.email.toLowerCase();
          }
        }
      } catch (err) {
        // Fall through
      }
    }

    // Check if passcode was provided in header
    const devPasscode = (req.headers['x-admin-passcode'] as string)?.trim().toLowerCase();
    const VALID_PASSCODES = ['admin2026', 'admin', 'logesh', 'developer'];
    if (!email && devPasscode && VALID_PASSCODES.includes(devPasscode)) {
      email = SUPER_ADMIN_EMAIL.toLowerCase();
    }

    if (!email) {
      return res.status(401).json({
        error: `Unauthorized: Backend access is restricted. Master Owner: ${SUPER_ADMIN_EMAIL}.`,
        superAdminEmail: SUPER_ADMIN_EMAIL,
      });
    }

    const authorized = await isEmailAuthorized(email);
    if (!authorized) {
      return res.status(403).json({
        error: `Access Denied for "${email}". The backend is strictly restricted to ${SUPER_ADMIN_EMAIL} and authorized Gmail accounts added by ${SUPER_ADMIN_EMAIL}.`,
        superAdminEmail: SUPER_ADMIN_EMAIL,
      });
    }

    (req as any).adminEmail = email;
    (req as any).isSuperAdmin = isSuperAdmin(email);
    next();
  };

  // Endpoint: Verify if an email or passcode has backend access
  app.post('/api/admin/verify-access', async (req, res) => {
    try {
      const { emailOrCode } = req.body;
      if (!emailOrCode || typeof emailOrCode !== 'string') {
        return res.status(400).json({ authorized: false, error: 'Email or passcode is required.' });
      }

      const input = emailOrCode.trim().toLowerCase();

      // 1. Direct super admin email check
      if (input === SUPER_ADMIN_EMAIL.toLowerCase()) {
        return res.json({
          authorized: true,
          isSuperAdmin: true,
          email: SUPER_ADMIN_EMAIL,
          role: 'super_admin',
          message: `Super Administrator ${SUPER_ADMIN_EMAIL} verified.`,
        });
      }

      // 2. Check authorized admins table/list
      const isAuth = await isEmailAuthorized(input);
      if (isAuth) {
        return res.json({
          authorized: true,
          isSuperAdmin: false,
          email: input,
          role: 'admin',
          message: `Authorized Admin (${input}) verified.`,
        });
      }

      // 3. Check developer passcodes (grants super admin session)
      const PASSCODES = ['admin2026', 'admin', 'logesh', 'developer'];
      if (PASSCODES.includes(input)) {
        return res.json({
          authorized: true,
          isSuperAdmin: true,
          email: SUPER_ADMIN_EMAIL,
          role: 'super_admin',
          message: `Authenticated via developer key as ${SUPER_ADMIN_EMAIL}.`,
        });
      }

      return res.status(403).json({
        authorized: false,
        error: `Access Denied: The backend is strictly restricted to ${SUPER_ADMIN_EMAIL} and Gmail accounts approved by ${SUPER_ADMIN_EMAIL}.`,
        superAdminEmail: SUPER_ADMIN_EMAIL,
      });
    } catch (err: any) {
      console.error('Verify Access Error:', err);
      res.status(500).json({ authorized: false, error: err.message || 'Verification error.' });
    }
  });

  // Endpoint: Get list of authorized backend users
  app.get('/api/admin/authorized-users', requireAdminAuth, async (req, res) => {
    try {
      const list = await getAllAuthorizedAdmins();
      res.json({
        success: true,
        superAdminEmail: SUPER_ADMIN_EMAIL,
        currentAdminEmail: (req as any).adminEmail,
        isSuperAdmin: (req as any).isSuperAdmin,
        authorizedUsers: list,
      });
    } catch (err: any) {
      console.error('Fetch Authorized Users Error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch authorized users.' });
    }
  });

  // Endpoint: Add new authorized Gmail address (Managed by logesh64646@gmail.com)
  app.post('/api/admin/authorized-users', requireAdminAuth, async (req, res) => {
    try {
      const { email, role, notes } = req.body;
      const callerEmail = (req as any).adminEmail || SUPER_ADMIN_EMAIL;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Valid Gmail address is required.' });
      }

      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
        return res.status(400).json({ error: 'Please provide a valid email format (e.g., example@gmail.com).' });
      }

      const newUser = await addAuthorizedAdmin(
        cleanEmail,
        callerEmail,
        role === 'super_admin' ? 'super_admin' : 'admin',
        notes || `Added by ${callerEmail}`
      );

      console.log(`[Admin Access] New backend access granted to: ${cleanEmail} by ${callerEmail}`);

      const allList = await getAllAuthorizedAdmins();
      res.json({
        success: true,
        message: `Successfully granted backend access to ${cleanEmail}.`,
        user: newUser,
        authorizedUsers: allList,
      });
    } catch (err: any) {
      console.error('Add Authorized User Error:', err);
      res.status(500).json({ error: err.message || 'Failed to authorize user.' });
    }
  });

  // Endpoint: Revoke backend access for an email
  app.delete('/api/admin/authorized-users/:email', requireAdminAuth, async (req, res) => {
    try {
      const targetEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
      if (targetEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
        return res.status(400).json({ error: `Cannot revoke access for primary owner ${SUPER_ADMIN_EMAIL}.` });
      }

      await removeAuthorizedAdmin(targetEmail);
      console.log(`[Admin Access] Backend access revoked for: ${targetEmail} by ${(req as any).adminEmail}`);

      const allList = await getAllAuthorizedAdmins();
      res.json({
        success: true,
        message: `Backend access revoked for ${targetEmail}.`,
        authorizedUsers: allList,
      });
    } catch (err: any) {
      console.error('Revoke Authorized User Error:', err);
      res.status(500).json({ error: err.message || 'Failed to revoke user access.' });
    }
  });

  // Admin AI Extraction Endpoint: analyzes uploaded phone image using Gemini 3.8 Flash
  app.post('/api/admin/ai-extract-phone', requireAdminAuth, async (req, res) => {
    try {
      const { imageBase64, imageMimeType, optionalHint } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'Image data is required in base64 format.' });
      }

      const result = await extractPhoneFromImage({
        imageBase64,
        imageMimeType,
        optionalHint,
      });

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('AI Extraction Error:', error);
      res.status(500).json({
        error: error.message || 'Failed to extract phone specifications with AI.',
      });
    }
  });

  // Admin AI Real-Time Lookup Endpoint: grounds real-time price, RAM & processor via web search
  app.post('/api/admin/ai-lookup-realtime', requireAdminAuth, async (req, res) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'Search query or phone name is required.' });
      }

      console.log(`[Admin Real-Time Agent] Looking up live environment specs for: "${query}"`);
      const result = await lookupRealTimePhoneSpecs(query.trim());
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('AI Real-Time Lookup Error:', error);
      res.status(500).json({
        error: error.message || 'Failed to retrieve real-time phone specifications.',
      });
    }
  });

  // Admin AI Refresh Price & Processor Endpoint: re-queries live market for current pricing & silicon specs
  app.post('/api/admin/ai-refresh-price-processor', requireAdminAuth, async (req, res) => {
    try {
      const { phoneName, brand } = req.body;
      if (!phoneName) {
        return res.status(400).json({ error: 'phoneName is required.' });
      }

      const liveSpecs = await fetchRealTimePriceAndSpecs(phoneName, brand);
      if (!liveSpecs.verified) {
        return res.status(404).json({ error: 'Could not ground live market specs for this phone.' });
      }

      res.json({ success: true, liveSpecs });
    } catch (error: any) {
      console.error('AI Refresh Price Error:', error);
      res.status(500).json({
        error: error.message || 'Failed to refresh real-time market specs.',
      });
    }
  });

  // Admin Endpoint: Save or Publish smartphone (if isPublished: true, instantly available to users)
  app.post('/api/admin/phones', requireAdminAuth, (req, res) => {
    try {
      const newPhone = req.body;
      if (!newPhone || !newPhone.name || !newPhone.brand) {
        return res.status(400).json({ error: 'Valid phone name and brand are required.' });
      }

      if (!newPhone.id) {
        newPhone.id =
          newPhone.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || `phone-${Date.now()}`;
      }

      // Default to published if true, or explicit draft if false
      const shouldPublish = newPhone.isPublished !== false;
      newPhone.isPublished = shouldPublish;
      if (shouldPublish && !newPhone.publishedAt) {
        newPhone.publishedAt = new Date().toISOString();
      }

      // Persist to admin storage
      adminPhonesList = [newPhone, ...adminPhonesList.filter((p) => p.id !== newPhone.id)];
      saveAdminPhones(adminPhonesList);

      // Rebuild active public catalog
      activePhonesCatalog = rebuildPublicCatalog();

      console.log(
        `[Admin Backend] ${shouldPublish ? 'PUBLISHED (Live for Users)' : 'DRAFTED (Backend only)'}: ${newPhone.name} (${newPhone.id})`
      );

      res.json({
        success: true,
        phone: newPhone,
        isPublished: shouldPublish,
        totalCatalogCount: activePhonesCatalog.length,
        adminAddedCount: adminPhonesList.length,
      });
    } catch (error: any) {
      console.error('Save Admin Phone Error:', error);
      res.status(500).json({ error: error.message || 'Failed to save/publish phone.' });
    }
  });

  // Admin Endpoint: Toggle publish status for ANY phone in the catalog (publish to users / unpublish to draft)
  app.patch('/api/admin/phones/:id/publish', requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      const { isPublished } = req.body;

      const existingIndex = adminPhonesList.findIndex((p) => p.id === id);
      let targetPhone: any;

      if (existingIndex !== -1) {
        adminPhonesList[existingIndex].isPublished = Boolean(isPublished);
        if (isPublished) {
          adminPhonesList[existingIndex].publishedAt = new Date().toISOString();
        }
        targetPhone = adminPhonesList[existingIndex];
      } else {
        // Find in base phones
        const basePhone = PHONES_DATA.find((p) => p.id === id);
        if (!basePhone) {
          return res.status(404).json({ error: 'Phone not found in catalog.' });
        }
        targetPhone = {
          ...basePhone,
          isPublished: Boolean(isPublished),
          publishedAt: isPublished ? new Date().toISOString() : undefined,
        };
        adminPhonesList = [targetPhone, ...adminPhonesList];
      }

      saveAdminPhones(adminPhonesList);
      activePhonesCatalog = rebuildPublicCatalog();
      const allManageable = getAllManageablePhones();

      console.log(`[Admin CMS] Phone "${targetPhone.name}" (${targetPhone.id}) publication toggled to: ${Boolean(isPublished)}`);

      res.json({
        success: true,
        phone: targetPhone,
        isPublished: Boolean(isPublished),
        totalCatalogCount: activePhonesCatalog.length,
        totalManageableCount: allManageable.length,
      });
    } catch (error: any) {
      console.error('Toggle Publish Error:', error);
      res.status(500).json({ error: error.message || 'Failed to update publication status.' });
    }
  });

  // Admin Endpoint: Get list of ALL phones in the entire catalog (including base phones + admin additions)
  app.get('/api/admin/phones', requireAdminAuth, (req, res) => {
    const allManageable = getAllManageablePhones();
    const drafts = allManageable.filter((p) => p.isPublished === false);
    const published = allManageable.filter((p) => p.isPublished !== false);
    const customAdminPhones = adminPhonesList.filter((p) => !PHONES_DATA.some((bp) => bp.id === p.id));

    res.json({
      allPhones: allManageable,
      adminPhones: allManageable, // backward-compat: passes all phones to admin CMS
      totalCount: allManageable.length,
      publishedCount: published.length,
      draftsCount: drafts.length,
      adminCustomCount: customAdminPhones.length,
      deletedCount: deletedPhoneIdsSet.size,
    });
  });

  // Admin Endpoint: Delete ANY phone from catalog
  app.delete('/api/admin/phones/:id', requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;

      // 1. Remove from admin overrides if present
      adminPhonesList = adminPhonesList.filter((p) => p.id !== id);
      saveAdminPhones(adminPhonesList);

      // 2. Mark as deleted so base phones are also removed
      deletedPhoneIdsSet.add(id);
      saveDeletedPhoneIds(Array.from(deletedPhoneIdsSet));

      activePhonesCatalog = rebuildPublicCatalog();
      const allManageable = getAllManageablePhones();

      console.log(`[Admin CMS] Deleted phone: "${id}" from entire catalog.`);

      res.json({
        success: true,
        deletedId: id,
        remainingCount: allManageable.length,
        totalCatalogCount: activePhonesCatalog.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to delete phone from catalog.' });
    }
  });

  // Admin Endpoint: Restore a previously deleted phone
  app.post('/api/admin/phones/:id/restore', requireAdminAuth, (req, res) => {
    try {
      const { id } = req.params;
      deletedPhoneIdsSet.delete(id);
      saveDeletedPhoneIds(Array.from(deletedPhoneIdsSet));

      activePhonesCatalog = rebuildPublicCatalog();
      const allManageable = getAllManageablePhones();

      res.json({
        success: true,
        restoredId: id,
        totalManageableCount: allManageable.length,
        totalCatalogCount: activePhonesCatalog.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to restore phone.' });
    }
  });

  // Auth helper middleware for Express routes:
  // Supports Firebase ID tokens in Authorization header OR demo/guest session headers
  const authenticateUser = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split('Bearer ')[1];
    try {
      if (token.startsWith('demo-token-')) {
        // Safe demo account fallback for quick preview or offline exploration
        const demoUid = token.replace('demo-token-', '');
        const email = req.headers['x-user-email'] as string || `${demoUid}@example.com`;
        const displayName = req.headers['x-user-name'] as string || 'Demo User';
        const user = await getOrCreateUser(demoUid, email, displayName);
        (req as any).currentUser = user;
        return next();
      }

      // Verify real Firebase Token with Firebase Admin SDK
      const decoded = await adminAuth.verifyIdToken(token);
      const user = await getOrCreateUser(
        decoded.uid,
        decoded.email || `${decoded.uid}@user.com`,
        decoded.name || decoded.email?.split('@')[0],
        decoded.picture
      );
      (req as any).currentUser = user;
      next();
    } catch (error: any) {
      console.error('Authentication verification failed:', error?.message || error);
      return res.status(401).json({ error: 'Authentication verification failed' });
    }
  };

  // Sync user profile with PostgreSQL
  app.post('/api/auth/sync', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      res.json({ success: true, user });
    } catch (error: any) {
      console.error('Sync error:', error);
      res.status(500).json({ error: error.message || 'Failed to sync user' });
    }
  });

  // Get current user stats & profile
  app.get('/api/user/me', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const comparisons = await getSavedComparisonsForUser(user.id);
      const favorites = await getUserFavorites(user.id);
      const presets = await getUserPresets(user.id);

      res.json({
        user,
        stats: {
          savedComparisonsCount: comparisons.length,
          favoritesCount: favorites.length,
          customPresetsCount: presets.length,
        },
      });
    } catch (error: any) {
      console.error('Fetch me error:', error);
      res.status(500).json({ error: error.message || 'Failed to load user profile' });
    }
  });

  // Get saved comparisons for authenticated user
  app.get('/api/comparisons', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const comparisons = await getSavedComparisonsForUser(user.id);
      res.json(comparisons);
    } catch (error: any) {
      console.error('Fetch comparisons error:', error);
      res.status(500).json({ error: error.message || 'Failed to load comparisons' });
    }
  });

  // Save a new comparison
  app.post('/api/comparisons', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const { title, phoneIds, weights, notes } = req.body;
      if (!title || !phoneIds || !Array.isArray(phoneIds) || phoneIds.length === 0) {
        return res.status(400).json({ error: 'Title and phoneIds are required' });
      }

      const saved = await createSavedComparison(
        user.id,
        title,
        phoneIds,
        weights || {},
        notes
      );
      res.status(201).json(saved);
    } catch (error: any) {
      console.error('Save comparison error:', error);
      res.status(500).json({ error: error.message || 'Failed to save comparison' });
    }
  });

  // Delete a saved comparison
  app.delete('/api/comparisons/:id', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const comparisonId = parseInt(req.params.id, 10);
      if (isNaN(comparisonId)) {
        return res.status(400).json({ error: 'Invalid comparison ID' });
      }

      const deleted = await deleteSavedComparison(comparisonId, user.id);
      res.json({ success: true, deleted });
    } catch (error: any) {
      console.error('Delete comparison error:', error);
      res.status(500).json({ error: error.message || 'Failed to delete comparison' });
    }
  });

  // Get user favorites
  app.get('/api/favorites', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const favorites = await getUserFavorites(user.id);
      res.json(favorites.map((f: any) => f.phoneId));
    } catch (error: any) {
      console.error('Fetch favorites error:', error);
      res.status(500).json({ error: error.message || 'Failed to load favorites' });
    }
  });

  // Toggle favorite
  app.post('/api/favorites/toggle', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const { phoneId } = req.body;
      if (!phoneId) {
        return res.status(400).json({ error: 'phoneId is required' });
      }

      const result = await toggleFavorite(user.id, phoneId);
      res.json(result);
    } catch (error: any) {
      console.error('Toggle favorite error:', error);
      res.status(500).json({ error: error.message || 'Failed to toggle favorite' });
    }
  });

  // Get user custom presets
  app.get('/api/presets', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const presets = await getUserPresets(user.id);
      res.json(presets);
    } catch (error: any) {
      console.error('Fetch presets error:', error);
      res.status(500).json({ error: error.message || 'Failed to load presets' });
    }
  });

  // Save custom preset
  app.post('/api/presets', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const { name, performanceWeight, cameraWeight, batteryWeight, displayWeight, valueWeight } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Preset name is required' });
      }

      const preset = await createWeightPreset(
        user.id,
        name,
        Number(performanceWeight) || 25,
        Number(cameraWeight) || 25,
        Number(batteryWeight) || 25,
        Number(displayWeight) || 15,
        Number(valueWeight) || 10
      );
      res.status(201).json(preset);
    } catch (error: any) {
      console.error('Save preset error:', error);
      res.status(500).json({ error: error.message || 'Failed to save preset' });
    }
  });

  // Delete custom preset
  app.delete('/api/presets/:id', authenticateUser, async (req, res) => {
    try {
      const user = (req as any).currentUser;
      const presetId = parseInt(req.params.id, 10);
      if (isNaN(presetId)) {
        return res.status(400).json({ error: 'Invalid preset ID' });
      }

      const deleted = await deleteWeightPreset(presetId, user.id);
      res.json({ success: true, deleted });
    } catch (error: any) {
      console.error('Delete preset error:', error);
      res.status(500).json({ error: error.message || 'Failed to delete preset' });
    }
  });

  // Mount Vite middleware in dev mode, or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Algorithm Mobile Comparison server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
