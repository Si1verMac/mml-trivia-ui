import { useState, useEffect } from 'react'
import Login from './components/Login'
import Register from './components/Register'
import Game from './components/Game'
import OperatorDashboard from './components/OperatorDashboard'
import { jwtDecode } from 'jwt-decode'
import * as signalR from '@microsoft/signalr'

function App() {
  const [token, setToken] = useState(null)
  const [isRegistering, setIsRegistering] = useState(false)
  const [isOperator, setIsOperator] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)
  const [gameId, setGameId] = useState(null)
  const [connection, setConnection] = useState(null)

  useEffect(() => {
    const storedToken = localStorage.getItem('jwtToken')
    if (storedToken) {
      setToken(storedToken)
      const decoded = jwtDecode(storedToken)
      if (decoded.role === 'operator') {
        setIsOperator(true)
      }
    }
    const storedGameId = localStorage.getItem('activeGameId')
    if (storedGameId) {
      setGameId(parseInt(storedGameId, 10))
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!token) {
      if (connection) {
        connection.stop().then(() => setConnection(null))
      }
      return
    }

    const conn = new signalR.HubConnectionBuilder()
      .withUrl(
        `https://localhost:7169/triviahub?access_token=${encodeURIComponent(
          token
        )}`,
        {
          skipNegotiation: true,
          transport: signalR.HttpTransportType.WebSockets,
        }
      )
      .configureLogging(signalR.LogLevel.Information)
      .withAutomaticReconnect()
      .build()

    conn
      .start()
      .then(() => {
        console.log('App-level SignalR connection established')
        setConnection(conn)

        // Add handler for JoinedOperatorGroup event
        conn.on('JoinedOperatorGroup', () => {
          console.log('Successfully joined operator group')
        })

        if (isOperator) {
          conn
            .invoke('JoinOperatorGroup')
            .catch((err) => console.error('JoinOperatorGroup error:', err))
        }
      })
      .catch((err) => console.error('App-level SignalR connection error:', err))

    return () => {
      conn
        .stop()
        .then(() => console.log('App-level SignalR connection stopped'))
    }
  }, [token, isOperator])

  const handleSetGameId = (id) => {
    setGameId(id)
    if (id) {
      localStorage.setItem('activeGameId', id.toString())
    } else {
      localStorage.removeItem('activeGameId')
    }
  }

  const handleLogin = (newToken) => {
    setToken(newToken)
    localStorage.setItem('jwtToken', newToken)
    const decoded = jwtDecode(newToken)
    if (decoded.role === 'operator') {
      setIsOperator(true)
    }
  }

  const handleRegisterSuccess = () => {
    setIsRegistering(false)
  }

  const handleLogout = () => {
    setToken(null)
    setIsOperator(false)
    setShowDashboard(false)
    handleSetGameId(null)
    localStorage.removeItem('jwtToken')
  }

  const toggleDashboard = () => {
    setShowDashboard(!showDashboard)
  }

  return (
    <div>
      <h1>McMillan Trivia</h1>
      {token ? (
        isOperator && showDashboard ? (
          <OperatorDashboard
            token={token}
            gameId={gameId}
            setGameId={handleSetGameId}
            onLogout={handleLogout}
            connection={connection}
          />
        ) : (
          <Game
            token={token}
            gameId={gameId}
            setGameId={handleSetGameId}
            onLogout={handleLogout}
            connection={connection}
          />
        )
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
      {isOperator && token && (
        <button onClick={toggleDashboard}>
          {showDashboard ? 'Back to Game' : 'Operator Dashboard'}
        </button>
      )}
    </div>
  )
}

export default App
