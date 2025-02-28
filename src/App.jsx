import { useState, useEffect } from 'react'
import Login from './components/Login'
import Register from './components/Register'
import Game from './components/Game'

function App() {
  const [token, setToken] = useState(null)
  const [gameId, setGameId] = useState(null)
  const [isRegistering, setIsRegistering] = useState(false)

  useEffect(() => {
    const storedToken = localStorage.getItem('jwtToken')
    if (storedToken) {
      setToken(storedToken)
    }
  }, [])

  const handleLogin = (newToken) => {
    setToken(newToken)
    localStorage.setItem('jwtToken', newToken)
  }

  const handleRegisterSuccess = () => {
    setIsRegistering(false)
  }

  const handleLogout = () => {
    setToken(null)
    setGameId(null)
    localStorage.removeItem('jwtToken')
  }

  return (
    <div>
      <h1>McMillan Trivia</h1>
      {token ? (
        <Game
          token={token}
          setGameId={setGameId}
          gameId={gameId}
          onLogout={handleLogout}
        />
      ) : isRegistering ? (
        <Register onRegisterSuccess={handleRegisterSuccess} />
      ) : (
        <Login onLogin={handleLogin} />
      )}
      {!token && (
        <button onClick={() => setIsRegistering(!isRegistering)}>
          {isRegistering ? 'Go to Login' : 'Go to Register'}
        </button>
      )}
    </div>
  )
}

export default App
