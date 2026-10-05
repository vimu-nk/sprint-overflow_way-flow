import { createFileRoute, Link } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/forgot-password')({ component: Forgot });

/** No self-service reset in this build (specs/19 SEC-09): accounts are managed by the operations admin. */
function Forgot() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="w-full max-w-[486px] rounded-card border border-line bg-white px-6 py-8 sm:px-12">
        <Logo />
        <KeyRound className="mt-6 size-8 text-brand" aria-hidden />
        <h1 className="mt-3 mb-2 text-[26px] font-semibold text-brand-ink">Reset your password</h1>
        <p className="m-0 text-muted">Passwords are reset by your operations administrator. Ask them for a new temporary password, then change it from Profile after you sign in.</p>
        <Link to="/" search={{}}>
          <Button className="mt-6" block variant="secondary">
            Back to sign in
          </Button>
        </Link>
      </div>
    </main>
  );
}
