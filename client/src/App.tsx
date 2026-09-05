import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Feed } from './components/Feed';
import { ReportForm } from './components/ReportForm';
import { MLALookup } from './components/MLALookup';

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 20px',
        borderBottom: '1px solid #e5e7eb',
      }}
    >
      <Link to="/" style={{ fontWeight: 800, fontSize: 20, textDecoration: 'none', color: '#111827' }}>
        Nagrik
      </Link>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Link to="/">Feed</Link>
        <Link to="/report">Report an issue</Link>
        <Link to="/mla">Find your MLA</Link>
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
          <Link to="/login">Log in</Link>
        )}
      </div>
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
