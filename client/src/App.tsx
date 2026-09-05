import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Feed } from './components/Feed';
import { ReportForm } from './components/ReportForm';
import { MLALookup } from './components/MLALookup';

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // close the mobile menu on resize to desktop so it doesn't linger
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = () => setMenuOpen(false);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const links = (
    <>
      <Link to="/" onClick={() => setMenuOpen(false)}>Feed</Link>
      <Link to="/report" onClick={() => setMenuOpen(false)}>Report an issue</Link>
      <Link to="/mla" onClick={() => setMenuOpen(false)}>Find your MLA</Link>
      {user ? (
        <button
          onClick={async () => {
            await logout();
            navigate('/');
          }}
        >
          Log out
        </button>
      ) : (
        <Link to="/login" onClick={() => setMenuOpen(false)}>Log in</Link>
      )}
    </>
  );

  return (
    <nav
      style={{
        borderBottom: '1px solid #e5e7eb',
        padding: '14px 20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Link to="/" style={{ fontWeight: 800, fontSize: 20, textDecoration: 'none', color: '#111827' }}>
            Nagrik
          </Link>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 0 }}>Report it. Track it. Fix it.</div>
        </div>
        {/* desktop links */}
        <div className="nav-desktop" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {links}
        </div>
        {/* hamburger (mobile only via CSS) */}
        <button
          className="nav-burger"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          style={{ display: 'none', fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
        >
          ☰
        </button>
      </div>
      {/* mobile menu */}
      {menuOpen && (
        <div className="nav-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12, marginTop: 12, borderTop: '1px solid #e5e7eb' }}>
          {links}
        </div>
      )}
    </nav>
  );
}

function LoginPage() {
  const { login, signup } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = form.get('email') as string;
    const password = form.get('password') as string;
    const mode = form.get('mode') as string;


    if (mode === 'signup') await signup(email, password);
    else await login(email, password);
    navigate('/');
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 360, margin: '40px auto', padding: 20 }}>
      <h2>Log in / Sign up</h2>
      <input name="email" type="email" placeholder="Email" required style={{ display: 'block', width: '100%', margin: '8px 0', padding: 8 }} />
      <input name="password" type="password" placeholder="Password" required style={{ display: 'block', width: '100%', margin: '8px 0', padding: 8 }} />
      <button name="mode" value="login" type="submit" style={{ marginRight: 8 }}>Log in</button>
      <button name="mode" value="signup" type="submit">Sign up</button>
    </form>
  );
}

// Global styles: responsive nav behavior + mobile tap-target sizing.
// Inline styles can't express media queries, so the few responsive rules
// live here (still zero dependencies).
const GLOBAL_CSS = `
@media (max-width: 639px) {
  .nav-desktop { display: none !important; }
  .nav-burger { display: block !important; }
  .nav-mobile a, .nav-mobile button { font-size: 16px; padding: 10px 0; text-align: left; }
  input, textarea, select { font-size: 16px !important; } /* stop iOS zoom-on-focus */
}
`;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <style>{GLOBAL_CSS}</style>
        <Nav />
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/report" element={<ReportForm onSubmitted={() => window.location.assign('/')} />} />
            <Route path="/mla" element={<MLALookup />} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}
