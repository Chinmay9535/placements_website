import Home from './Home';
import Admin from './Admin';
import Privacy from './Privacy';

export default function App() {
  const path = window.location.pathname;
  if (path.startsWith('/admin')) return <Admin />;
  if (path.startsWith('/privacy')) return <Privacy />;
  return <Home />;
}
