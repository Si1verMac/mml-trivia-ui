import { useState, useEffect, useCallback } from 'react'
import * as signalR from '@microsoft/signalr'
import Game from './components/Game'
import Login from './components/Login'
import Register from './components/Register'
import OperatorDashboard from './components/OperatorDashboard'
import Header from './components/Header'
import { jwtDecode } from 'jwt-decode'

import './App.css'

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [error, setError] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [isOperator, setIsOperator] = useState(false)
  const [showDashboard, setShowDashboard] = useState(() => {
    const stored = localStorage.getItem('showDashboard')
    return stored ? JSON.parse(stored) : false
  })
  const [connection, setConnection] = useState(null)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [gameId, setGameId] = useState(() => {
    const savedGameId = localStorage.getItem('gameId')
    return savedGameId ? parseInt(savedGameId, 10) : null
  })

  // Simplified game state management with persistence
  const [gameState, setGameState] = useState(() => {
    try {
      const savedState = localStorage.getItem('gameState')
      const parsedState = savedState ? JSON.parse(savedState) : null
      console.log(
        'Initial gameState loaded from localStorage:',
        parsedState ? 'Found' : 'Not found'
      )
      return (
        parsedState || {
          currentPhase: 'idle',
          timeLeft: 0,
          question: null,
          correctAnswer: null,
          currentQuestionId: null,
          preservedFromToggle: false,
        }
      )
    } catch (error) {
      console.error('Error parsing gameState from localStorage:', error)
      return {
        currentPhase: 'idle',
        timeLeft: 0,
        question: null,
        correctAnswer: null,
        currentQuestionId: null,
        preservedFromToggle: false,
      }
    }
  })

  // Persist gameId and gameState to localStorage
  useEffect(() => {
    localStorage.setItem('gameId', gameId || '')
    localStorage.setItem('gameState', JSON.stringify(gameState))
  }, [gameId, gameState])

  // Function to update game state that preserves unchanged values
  const updateGameState = useCallback((update) => {
    console.log('updateGameState called with:', update)
    setGameState((prevState) => {
      const newState =
        typeof update === 'function'
          ? update(prevState)
          : { ...prevState, ...update }
      try {
        localStorage.setItem('gameState', JSON.stringify(newState))
        console.log('Successfully updated gameState and saved to localStorage')
        return newState
      } catch (error) {
        console.error('Error saving gameState to localStorage:', error)
        return newState
      }
    })
  }, [])

  // Check for operator role when token is loaded
  useEffect(() => {
    if (token) {
      try {
        const decoded = jwtDecode(token)
        console.log('Token content:', decoded)
        setIsOperator(decoded.role === 'operator')
      } catch (err) {
        console.error('Error decoding token:', err)
      }
    }
  }, [token])

  useEffect(() => {
    if (!token) return

    let isMounted = true
    let newConnection = null

    if (connection) {
      console.log('Existing SignalR connection found, skipping setup')
      return
    }

    newConnection = new signalR.HubConnectionBuilder()
      .withUrl('https://localhost:7169/triviahub', {
        accessTokenFactory: () => token,
        withCredentials: false,
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 20000, 30000])
      .configureLogging(signalR.LogLevel.Information)
      .build()

    // Reconnection handlers remain the same as in your current code
    newConnection.onreconnecting((error) => {
      console.log('Connection reconnecting due to: ', error)
      setIsReconnecting(true)
    })

    newConnection.onreconnected((connectionId) => {
      console.log('Connection reestablished. ConnectionId: ', connectionId)
      setIsReconnecting(false)
      if (gameId) {
        newConnection
          .invoke('JoinGame', gameId, parseInt(jwtDecode(token).teamId, 10))
          .then(() =>
            newConnection.invoke(
              'RequestGameState',
              gameId,
              parseInt(jwtDecode(token).teamId, 10)
            )
          )
          .catch((err) => console.error('Error rejoining game:', err))
      }
    })

    newConnection.onclose((error) => {
      console.log('Connection closed due to: ', error)
      restartConnection(newConnection)
    })

    const startConnection = async () => {
      try {
        await newConnection.start()
        console.log('SignalR connection started successfully')
        if (isMounted) {
          setConnection(newConnection)
          if (gameId) {
            const teamId = parseInt(jwtDecode(token).teamId, 10)
            await newConnection.invoke('JoinGame', gameId, teamId)
            await newConnection.invoke('RequestGameState', gameId, teamId)
          }
        }
      } catch (err) {
        console.error('Error starting SignalR connection: ', err)
        if (isMounted) {
          setTimeout(startConnection, 5000)
        }
      }
    }

    startConnection()

    return () => {
      isMounted = false
      if (
        newConnection &&
        newConnection.state !== signalR.HubConnectionState.Disconnected
      ) {
        console.log('Stopping SignalR connection on cleanup')
        newConnection.stop().then(() => {
          if (isMounted) {
            setConnection(null)
          }
        })
      }
    }
  }, [token]) // Added gameId to dependencies for rejoin logic then took it out because users couldn't log in

  const restartConnection = (conn) => {
    setTimeout(async () => {
      try {
        await conn.start()
        console.log('Connection restarted successfully')
        setIsReconnecting(false)
        if (gameId) {
          const teamId = parseInt(jwtDecode(token).teamId, 10)
          await conn.invoke('JoinGame', gameId, teamId)
          await conn.invoke('RequestGameState', gameId, teamId)
        }
      } catch (err) {
        console.error('Error restarting connection: ', err)
        restartConnection(conn)
      }
    }, 5000)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('showDashboard')
    localStorage.removeItem('operatorSelectedGameId')
    localStorage.removeItem('gameId') // Clear persisted gameId
    localStorage.removeItem('gameState') // Clear persisted gameState
    setToken(null)
    setIsOperator(false)
    setShowDashboard(false)
    setGameId(null)
    updateGameState({
      currentPhase: 'idle',
      currentQuestionId: null,
      question: null,
      correctAnswer: null,
    })
    if (connection) {
      connection.stop()
    }
  }

  const handleLogin = (newToken) => {
    console.log(
      'handleLogin called with token:',
      newToken.substring(0, 20) + '...'
    )
    localStorage.setItem('token', newToken)
    setToken(newToken)
    setError('')

    try {
      const decoded = jwtDecode(newToken)
      console.log('Login token:', decoded)
      setIsOperator(decoded.role === 'operator')
    } catch (err) {
      console.error('Error processing login token:', err)
    }
  }

  const handleRegisterSuccess = () => {
    setIsRegistering(false)
  }

  const toggleDashboard = () => {
    // Store the current game state before switching views
    const currentGameState = {
      ...gameState,
      preservedFromToggle: true,
    }

    console.log(
      `Toggling dashboard. Current timeLeft: ${gameState.timeLeft || 0} seconds`
    )

    // Toggle dashboard view
    setShowDashboard((prev) => {
      const newValue = !prev
      localStorage.setItem('showDashboard', JSON.stringify(newValue))

      // If switching back to game view from dashboard, ensure we preserve state
      if (prev === true && connection) {
        console.log(
          `Switching back to game view with preserved state. Preserved timeLeft: ${
            currentGameState.timeLeft || 0
          } seconds`
        )
        updateGameState(currentGameState)
      }

      return newValue
    })
  }

  // Clear preservedFromToggle flag after it has been used
  useEffect(() => {
    console.log('Starting preservedFromToggle effect. Current state:', {
      preservedFromToggle: gameState.preservedFromToggle,
      showDashboard,
      token,
    })

    if (gameState.preservedFromToggle && !showDashboard) {
      // Only set a timer to clear the flag once the game view is rendered
      try {
        const timer = setTimeout(() => {
          console.log('Clearing preservedFromToggle flag')
          // Use functional update to prevent using stale state
          updateGameState((prevState) => ({
            ...prevState,
            preservedFromToggle: false,
          }))
        }, 3000) // Give ample time for components to use the flag

        return () => clearTimeout(timer)
      } catch (error) {
        console.error('Error in preservedFromToggle effect:', error)
      }
    }
  }, [gameState.preservedFromToggle, showDashboard, updateGameState])

  if (!token) {
    console.log('No token found, rendering login/register screens')
    return (
      <div className='main-container'>
        <Header />
        {isRegistering ? (
          <Register onRegisterSuccess={handleRegisterSuccess} />
        ) : (
          <Login onLogin={handleLogin} />
        )}
        <button onClick={() => setIsRegistering(!isRegistering)}>
          {isRegistering ? 'Go to Login' : 'Go to Register'}
        </button>
      </div>
    )
  }

  try {
    const decoded = jwtDecode(token)

    if (!decoded || !decoded.exp) {
      throw new Error('Invalid token')
    }

    const currentTime = Date.now() / 1000
    if (decoded.exp < currentTime) {
      handleLogout()
      setError('Your session has expired. Please login again.')
      return (
        <div className='main-container'>
          <Header />
          <Login onLogin={handleLogin} error={error} setError={setError} />
        </div>
      )
    }

    if (isOperator && showDashboard) {
      return (
        <div className='main-container'>
          <Header />
          <OperatorDashboard
            token={token}
            onLogout={handleLogout}
            connection={connection}
            isReconnecting={isReconnecting}
            gameState={gameState}
            updateGameState={updateGameState}
          />
          <button className='operator-button' onClick={toggleDashboard}>
            Back to Game
          </button>
        </div>
      )
    }

    return (
      <div className='main-container'>
        <Header />
        <Game
          token={token}
          gameId={gameId}
          setGameId={setGameId}
          onLogout={handleLogout}
          connection={connection}
          isReconnecting={isReconnecting}
          gameState={gameState}
          updateGameState={updateGameState}
        />
        {isOperator && (
          <button className='operator-button' onClick={toggleDashboard}>
            Operator Dashboard
          </button>
        )}
      </div>
    )
  } catch (err) {
    console.error('Error decoding token: ', err)
    handleLogout()
    setError('Invalid token. Please login again.')
    return (
      <div className='main-container'>
        <Header />
        <Login onLogin={handleLogin} error={error} setError={setError} />
      </div>
    )
  }
}

export default App
