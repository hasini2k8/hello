// App.js
import React, { useState } from 'react';
import VoiceNotes from './components/VoiceNotes';
import './components/VoiceNotes.css';

const App = () => {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // login or signup
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  // Handle login/signup
  const handleAuth = (e) => {
    e.preventDefault();
    const { email, password } = credentials;

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }

    // For simplicity, store credentials in localStorage (simulate file)
    const storedUsers = JSON.parse(localStorage.getItem('users') || '{}');

    if (authMode === 'signup') {
      if (storedUsers[email]) {
        setError('User already exists. Please login.');
        return;
      }
      storedUsers[email] = password;
      localStorage.setItem('users', JSON.stringify(storedUsers));
      setUser({ email });
      setError('');
    } else {
      if (!storedUsers[email] || storedUsers[email] !== password) {
        setError('Invalid email or password.');
        return;
      }
      setUser({ email });
      setError('');
    }
  };

  const handleLogout = () => {
    setUser(null);
    setCredentials({ email: '', password: '' });
    setAuthMode('login');
  };

  return (
    <div className="app-wrapper">
      {!user ? (
        <div className="auth-box">
          <h2>{authMode === 'login' ? 'Login' : 'Sign Up'}</h2>
          {error && <div className="error-box">{error}</div>}
          <form onSubmit={handleAuth}>
            <input
              type="email"
              placeholder="Email"
              value={credentials.email}
              onChange={(e) => setCredentials({ ...credentials, email: e.target.value })}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={credentials.password}
              onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
              required
            />
            <button type="submit">{authMode === 'login' ? 'Login' : 'Sign Up'}</button>
          </form>
          <p>
            {authMode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              className="switch-btn"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'signup' : 'login');
                setError('');
              }}
            >
              {authMode === 'login' ? 'Sign Up' : 'Login'}
            </button>
          </p>
        </div>
      ) : (
        <>
          <div className="logout-btn-wrapper">
            <button className="logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
          <VoiceNotes />
        </>
      )}
    </div>
  );
};

export default App;
