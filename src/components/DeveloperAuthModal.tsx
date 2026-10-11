import React, { useState } from 'react';
import { Lock, ShieldCheck, AlertCircle, X, KeyRound, Terminal, Loader2, UserCheck } from 'lucide-react';

interface DeveloperAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  verifyCode: (code: string) => boolean | Promise<{ success: boolean; error?: string }>;
}

export const DeveloperAuthModal: React.FC<DeveloperAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  verifyCode,
}) => {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) {
      setError('Please enter your authorized email or passcode.');
      return;
    }

    setError(null);
    setIsVerifying(true);

    try {
      const result = await Promise.resolve(verifyCode(passcode));
      if (typeof result === 'boolean') {
        if (result) {
          setPasscode('');
          onSuccess();
        } else {
          setError('Access Denied: Only logesh64646@gmail.com or Gmails authorized by logesh64646@gmail.com are permitted.');
        }
      } else if (result.success) {
        setPasscode('');
        onSuccess();
      } else {
        setError(result.error || 'Access Denied: You are not authorized to access this backend.');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Developer Backend Access</h3>
            <p className="text-xs text-indigo-400 font-medium">Restricted to logesh64646@gmail.com</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-200">Owner Authorization Required</p>
              <p className="mt-0.5 text-slate-400 text-[11px] leading-relaxed">
                Backend access is strictly reserved for <span className="text-amber-300 font-mono">logesh64646@gmail.com</span> and additional Gmail accounts explicitly authorized inside the admin portal.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">
              Authorized Gmail or Developer Key
            </label>
            <div className="relative">
              <input
                type="text"
                autoFocus
                placeholder="logesh64646@gmail.com or authorized email"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pl-9 text-xs text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              <KeyRound className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>Owner: <code className="text-indigo-300 font-mono">logesh64646@gmail.com</code></span>
              <span>Passcode: <code className="text-slate-400 font-mono">admin2026</code></span>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span className="leading-tight">{error}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isVerifying}
              className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isVerifying}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Unlock Backend</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
