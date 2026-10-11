import { useState, useEffect, useCallback } from 'react';

const DEVELOPER_STORAGE_KEY = 'niyo_developer_session_authorized';
const DEVELOPER_EMAIL_KEY = 'niyo_developer_active_email';
export const SUPER_ADMIN_EMAIL = 'logesh64646@gmail.com';
const DEVELOPER_PASSCODES = ['admin2026', 'admin', 'logesh', 'developer'];

export function useDeveloperMode(currentUserEmail?: string | null) {
  const [activeAdminEmail, setActiveAdminEmail] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(DEVELOPER_EMAIL_KEY) || SUPER_ADMIN_EMAIL;
    }
    return SUPER_ADMIN_EMAIL;
  });

  const [isDeveloper, setIsDeveloper] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (
        params.get('admin') === 'true' ||
        params.get('admin') === '1' ||
        params.get('dev') === 'true' ||
        params.get('dev') === '1'
      ) {
        sessionStorage.setItem(DEVELOPER_STORAGE_KEY, 'true');
        return true;
      }

      if (sessionStorage.getItem(DEVELOPER_STORAGE_KEY) === 'true') {
        return true;
      }
    }
    return false;
  });

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Sync when user logs in with master developer email or authorized email
  useEffect(() => {
    if (!currentUserEmail) return;
    const cleanUserEmail = currentUserEmail.trim().toLowerCase();

    // If master super admin
    if (cleanUserEmail === SUPER_ADMIN_EMAIL.toLowerCase()) {
      setIsDeveloper(true);
      setActiveAdminEmail(SUPER_ADMIN_EMAIL);
      sessionStorage.setItem(DEVELOPER_STORAGE_KEY, 'true');
      sessionStorage.setItem(DEVELOPER_EMAIL_KEY, SUPER_ADMIN_EMAIL);
      return;
    }

    // Check if authorized backend email
    fetch('/api/admin/verify-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrCode: cleanUserEmail }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.authorized) {
          setIsDeveloper(true);
          setActiveAdminEmail(cleanUserEmail);
          sessionStorage.setItem(DEVELOPER_STORAGE_KEY, 'true');
          sessionStorage.setItem(DEVELOPER_EMAIL_KEY, cleanUserEmail);
        }
      })
      .catch((err) => {
        console.error('Error verifying user developer status:', err);
      });
  }, [currentUserEmail]);

  // Global hotkey: Ctrl + Shift + A (or Cmd + Shift + A) to toggle developer access
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        setIsAuthModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const verifyAndEnable = useCallback(async (inputCode: string): Promise<{ success: boolean; error?: string }> => {
    const cleaned = inputCode.trim().toLowerCase();

    // Fast-path client check
    if (
      DEVELOPER_PASSCODES.includes(cleaned) ||
      cleaned === SUPER_ADMIN_EMAIL.toLowerCase()
    ) {
      setIsDeveloper(true);
      setActiveAdminEmail(SUPER_ADMIN_EMAIL);
      sessionStorage.setItem(DEVELOPER_STORAGE_KEY, 'true');
      sessionStorage.setItem(DEVELOPER_EMAIL_KEY, SUPER_ADMIN_EMAIL);
      setIsAuthModalOpen(false);
      return { success: true };
    }

    // Check backend authorization (for authorized Gmails added by logesh64646@gmail.com)
    try {
      const res = await fetch('/api/admin/verify-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrCode: cleaned }),
      });

      const data = await res.json();
      if (res.ok && data.authorized) {
        setIsDeveloper(true);
        setActiveAdminEmail(data.email || cleaned);
        sessionStorage.setItem(DEVELOPER_STORAGE_KEY, 'true');
        sessionStorage.setItem(DEVELOPER_EMAIL_KEY, data.email || cleaned);
        setIsAuthModalOpen(false);
        return { success: true };
      } else {
        return {
          success: false,
          error: data.error || `Access Denied: The backend is strictly restricted to ${SUPER_ADMIN_EMAIL} and authorized Gmail accounts added by ${SUPER_ADMIN_EMAIL}.`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Could not verify credentials with backend: ${err.message}`,
      };
    }
  }, []);

  const disableDeveloperMode = useCallback(() => {
    setIsDeveloper(false);
    sessionStorage.removeItem(DEVELOPER_STORAGE_KEY);
    sessionStorage.removeItem(DEVELOPER_EMAIL_KEY);
    if (typeof window !== 'undefined' && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('admin');
      url.searchParams.delete('dev');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []);

  return {
    isDeveloper,
    activeAdminEmail,
    isSuperAdmin: activeAdminEmail.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase(),
    isAuthModalOpen,
    setIsAuthModalOpen,
    verifyAndEnable,
    disableDeveloperMode,
  };
}
