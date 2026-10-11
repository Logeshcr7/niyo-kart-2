import fs from 'fs';
import path from 'path';
import { getAuthorizedAdminsList, addAuthorizedAdminDb, removeAuthorizedAdminDb } from '../src/db/queries.ts';

export const SUPER_ADMIN_EMAIL = 'logesh64646@gmail.com';

export interface AuthorizedAdmin {
  id?: number;
  email: string;
  addedBy: string;
  role: 'super_admin' | 'admin';
  notes?: string | null;
  createdAt?: string;
}

const LOCAL_STORAGE_FILE = path.join(process.cwd(), 'src', 'data', 'authorizedAdmins.json');

// Helper to read local json backup
function readLocalAdmins(): AuthorizedAdmin[] {
  try {
    if (fs.existsSync(LOCAL_STORAGE_FILE)) {
      const data = fs.readFileSync(LOCAL_STORAGE_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error reading authorizedAdmins.json:', err);
  }
  return [];
}

// Helper to write local json backup
function writeLocalAdmins(admins: AuthorizedAdmin[]): void {
  try {
    const dir = path.dirname(LOCAL_STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LOCAL_STORAGE_FILE, JSON.stringify(admins, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing authorizedAdmins.json:', err);
  }
}

/**
 * Checks if an email is the primary super admin
 */
export function isSuperAdmin(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

/**
 * Retrieves all authorized admins, always ensuring logesh64646@gmail.com is present as super_admin
 */
export async function getAllAuthorizedAdmins(): Promise<AuthorizedAdmin[]> {
  const masterEntry: AuthorizedAdmin = {
    email: SUPER_ADMIN_EMAIL,
    addedBy: 'SYSTEM (PRIMARY OWNER)',
    role: 'super_admin',
    notes: 'Master administrator with full permissions to add/remove backend access',
    createdAt: new Date().toISOString(),
  };

  let dbList: AuthorizedAdmin[] = [];
  try {
    const rows = await getAuthorizedAdminsList();
    dbList = rows.map((r) => ({
      id: r.id,
      email: r.email,
      addedBy: r.addedBy,
      role: (r.role as 'super_admin' | 'admin') || 'admin',
      notes: r.notes,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('PostgreSQL query for authorized admins failed, falling back to local storage file:', err);
    dbList = readLocalAdmins();
  }

  // Ensure super admin is in list and unique
  const otherAdmins = dbList.filter(
    (a) => a.email.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()
  );

  const fullList = [masterEntry, ...otherAdmins];
  writeLocalAdmins(fullList);
  return fullList;
}

/**
 * Checks if a given email has backend access
 */
export async function isEmailAuthorized(email?: string | null): Promise<boolean> {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }

  try {
    const all = await getAllAuthorizedAdmins();
    return all.some((a) => a.email.toLowerCase() === cleanEmail);
  } catch (err) {
    const local = readLocalAdmins();
    return local.some((a) => a.email.toLowerCase() === cleanEmail);
  }
}

/**
 * Adds an authorized Gmail address to the backend
 */
export async function addAuthorizedAdmin(
  newEmail: string,
  addedByEmail: string,
  role: 'admin' | 'super_admin' = 'admin',
  notes?: string
): Promise<AuthorizedAdmin> {
  const cleanNewEmail = newEmail.trim().toLowerCase();
  const cleanAddedBy = addedByEmail.trim().toLowerCase();

  // Basic email validation
  if (!cleanNewEmail.includes('@') || !cleanNewEmail.includes('.')) {
    throw new Error('Please enter a valid email address.');
  }

  if (cleanNewEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
    return {
      email: SUPER_ADMIN_EMAIL,
      addedBy: 'SYSTEM (PRIMARY OWNER)',
      role: 'super_admin',
      notes: 'Master administrator',
    };
  }

  try {
    const row = await addAuthorizedAdminDb(cleanNewEmail, cleanAddedBy, role, notes);
    const entry: AuthorizedAdmin = {
      id: row.id,
      email: row.email,
      addedBy: row.addedBy,
      role: (row.role as 'admin' | 'super_admin') || 'admin',
      notes: row.notes,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    };

    // Update local cache
    const current = readLocalAdmins();
    const updated = [entry, ...current.filter((c) => c.email.toLowerCase() !== cleanNewEmail)];
    writeLocalAdmins(updated);
    return entry;
  } catch (err) {
    console.warn('DB insert failed, writing to local JSON file:', err);
    const entry: AuthorizedAdmin = {
      email: cleanNewEmail,
      addedBy: cleanAddedBy,
      role,
      notes: notes || null,
      createdAt: new Date().toISOString(),
    };
    const current = readLocalAdmins();
    const updated = [entry, ...current.filter((c) => c.email.toLowerCase() !== cleanNewEmail)];
    writeLocalAdmins(updated);
    return entry;
  }
}

/**
 * Removes an authorized Gmail address
 */
export async function removeAuthorizedAdmin(emailToRemove: string): Promise<boolean> {
  const cleanEmail = emailToRemove.trim().toLowerCase();

  // Protect master owner
  if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('Cannot remove primary super administrator logesh64646@gmail.com.');
  }

  try {
    await removeAuthorizedAdminDb(cleanEmail);
  } catch (err) {
    console.warn('DB delete failed, falling back to local JSON file:', err);
  }

  const current = readLocalAdmins();
  const filtered = current.filter((c) => c.email.toLowerCase() !== cleanEmail);
  writeLocalAdmins(filtered);
  return true;
}
