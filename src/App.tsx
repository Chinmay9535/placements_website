import Home from './Home';
import Admin from './Admin';

export default function App() {
  return window.location.pathname.startsWith('/admin') ? <Admin /> : <Home />;
}
