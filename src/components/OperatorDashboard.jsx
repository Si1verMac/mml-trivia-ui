import { useState, useEffect, useRef } from 'react'
import * as signalR from '@microsoft/signalr'
import axios from 'axios'
import PropTypes from 'prop-types'
import { jwtDecode } from 'jwt-decode'

const OperatorDashboard = ({
  token,
  gameId: initialGameId,
  onLogout,
  connection,
  gameState,
  updateGameState,
}) => {
  const [scores, setScores] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('Disconnected')
  const [games, setGames] = useState([])
  const [localGameId, setLocalGameId] = useState(() => {
    const storedGameId = localStorage.getItem('operatorSelectedGameId')
    return storedGameId ? parseInt(storedGameId, 10) : initialGameId
  })
  const [correctAnswer, setCorrectAnswer] = useState(null)
  const [gamePhase, setGamePhase] = useState('unknown')
  const [questionText, setQuestionText] = useState('')
  const decoded = jwtDecode(token)
  const teamId = parseInt(decoded.teamId, 10)
  const previousGameIdRef = useRef(null)

  // Fetch all games and set the most recent as default
  useEffect(() => {
    const fetchGames = async () => {
      try {
        const response = await axios.get(
          'https://localhost:7169/api/game/all',
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )
        const gameList = response.data
        setGames(gameList)
        if (!localGameId && gameList.length > 0) {
          const defaultGame = gameList[0] // Most recent game
          setLocalGameId(defaultGame.id)
          localStorage.setItem('operatorSelectedGameId', defaultGame.id)
          fetchScores(defaultGame.id)
        } else if (localGameId) {
          fetchScores(localGameId)
        }
      } catch (err) {
        console.error('Error fetching games:', err)
      }
    }
    fetchGames()
  }, [token, localGameId]) // Include localGameId in dependencies

  const fetchScores = async (id) => {
    if (!id) return
    try {
      const response = await axios.get(
        `https://localhost:7169/api/game/${id}/scores`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      setScores(response.data)
    } catch (err) {
      console.error('Error fetching scores:', err)
    }
  }

  // Handle SignalR connection setup and events
  useEffect(() => {
    if (!connection) return

    connection.on('JoinedOperatorGroup', () => {
      setConnectionStatus('Connected')
    })

    connection.on('ScoresUpdated', (gameId, updatedScores) => {
      if (gameId === localGameId) {
        setScores(updatedScores)
      }
    })

    connection.on('Question', (qData) => {
      setGamePhase('question')
      setCorrectAnswer(null)
      setQuestionText(qData.text)
      updateGameState({
        currentQuestionId: qData.id,
        question: qData,
        correctAnswer: null,
        currentPhase: 'question',
      })
    })

    connection.on('DisplayAnswer', (qId, correctAns) => {
      setCorrectAnswer(`Correct answer: ${correctAns}`)
      setGamePhase('reveal')
      updateGameState({
        currentQuestionId: qId,
        correctAnswer: `Correct answer: ${correctAns}`,
        currentPhase: 'reveal',
      })
    })

    // Add no-op handlers for events from Game.jsx or App.jsx
    connection.on('TeamJoined', () => {
      // Do nothing - this is for Game.jsx
    })

    connection.on('GameState', () => {
      // Do nothing - this is for Game.jsx
    })

    connection.on('AnswerSubmitted', () => {
      // Do nothing - this is for Game.jsx
    })

    connection.on('TeamSignaledReady', () => {
      // Do nothing - this is for Game.jsx
    })
    connection.on('GameStarted', () => {
      updateGameState({ currentPhase: 'question' })
    })

    connection.on('GameEnded', () => {
      updateGameState({ currentPhase: 'ended' })
    })

    const setupConnection = async () => {
      if (connection.state === signalR.HubConnectionState.Disconnected) {
        await connection.start()
      }
      await connection.invoke('JoinOperatorGroup')
      if (localGameId) {
        await connection.invoke('JoinGame', localGameId, teamId)
        fetchScores(localGameId)
      }
    }

    setupConnection().catch(console.error)

    connection.onclose(() => setConnectionStatus('Disconnected'))
    connection.onreconnecting(() => setConnectionStatus('Reconnecting…'))
    connection.onreconnected(() => {
      setConnectionStatus('Connected')
      setupConnection().catch(console.error)
    })

    return () => {
      // Cleanup handled by App.jsx
    }
  }, [connection, localGameId, teamId, token, updateGameState])

  // Handle game group changes
  useEffect(() => {
    if (!connection || connection.state !== 'Connected') return

    const joinGame = async (gameId) => {
      await connection.invoke('JoinGame', gameId, teamId)
    }

    const leaveGame = async (gameId) => {
      await connection.invoke('LeaveGame', gameId, teamId)
    }

    if (
      previousGameIdRef.current &&
      previousGameIdRef.current !== localGameId
    ) {
      leaveGame(previousGameIdRef.current)
    }
    if (localGameId) {
      joinGame(localGameId)
      fetchScores(localGameId) // Initial fetch, then rely on SignalR
    }
    previousGameIdRef.current = localGameId

    return () => {
      if (localGameId && connection.state === 'Connected') {
        leaveGame(localGameId).catch(console.error)
      }
    }
  }, [localGameId, connection, teamId])

  const handleGameChange = (e) => {
    const newGameId = parseInt(e.target.value, 10) || null
    setLocalGameId(newGameId)
    if (newGameId) {
      localStorage.setItem('operatorSelectedGameId', newGameId)
      fetchScores(newGameId)
    } else {
      localStorage.removeItem('operatorSelectedGameId')
    }
  }

  return (
    <div className='operator-dashboard'>
      <h2>Operator Dashboard</h2>
      <p>
        Team ID: {teamId} (Role: {decoded.role})
      </p>
      <p>Connection Status: {connectionStatus}</p>
      <div>
        <label>
          Select Game:
          <select value={localGameId || ''} onChange={handleGameChange}>
            <option value='' disabled>
              Select a game
            </option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                Game {game.id} - {game.name} ({game.status})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>Current Phase: {gamePhase}</p>
      {gamePhase === 'question' && questionText && (
        <div>
          <h3>Current Question</h3>
          <p>{questionText}</p>
        </div>
      )}
      {gamePhase === 'reveal' && correctAnswer && (
        <div>
          <h3>Current Answer</h3>
          <p>{correctAnswer}</p>
        </div>
      )}
      <h3>Team Scores for Game {localGameId}</h3>
      {scores.length === 0 ? (
        <p>No scores available</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Team ID</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.teamId}>
                <td>{s.teamId}</td>
                <td>{s.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={onLogout}>Logout</button>
    </div>
  )
}

OperatorDashboard.propTypes = {
  token: PropTypes.string.isRequired,
  gameId: PropTypes.number,
  onLogout: PropTypes.func.isRequired,
  connection: PropTypes.object,
  gameState: PropTypes.object.isRequired,
  updateGameState: PropTypes.func.isRequired,
}

export default OperatorDashboard
