import { useState, useEffect, useRef } from 'react'
import * as signalR from '@microsoft/signalr'
import axios from 'axios'
import PropTypes from 'prop-types'
import { jwtDecode } from 'jwt-decode'

const OperatorDashboard = ({
  token,
  gameId: initialGameId,
  setGameId,
  onLogout,
  connection,
}) => {
  const [scores, setScores] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('Disconnected')
  const [localGameId, setLocalGameId] = useState(initialGameId)
  const [correctAnswer, setCorrectAnswer] = useState(null)
  const [gamePhase, setGamePhase] = useState('unknown')
  const hubConnectionRef = useRef(null)
  const decoded = jwtDecode(token)
  const teamId = parseInt(decoded.teamId, 10)

  const fetchScores = async (id) => {
    try {
      const response = await axios.get(
        `https://localhost:7169/api/game/${id}/scores`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      console.log('Fetched scores:', response.data)
      setScores(response.data)
    } catch (err) {
      console.error('Error fetching scores:', err)
    }
  }

  connection.on('scoresupdated', (scoresupdated) => {
    console.log('Received scores:', scoresupdated)
    setScores(scoresupdated)
  })

  useEffect(() => {
    if (!connection) return

    hubConnectionRef.current = connection

    // Handler for 'joinedoperatorgroup'
    connection.on('JoinedOperatorGroup', (message) => {
      console.log('Joined operator group:', message)
      setConnectionStatus('Connected')
    })

    // Listen for score updates
    connection.on('ScoresUpdated', (scoresupdated) => {
      setScores(scoresupdated)
      console.log('Scores updated:', scoresupdated)
    })

    // Also listen for DisplayAnswer events
    connection.on('DisplayAnswer', (qId, correctAns) => {
      console.log('DisplayAnswer event received in operator dashboard:', {
        qId,
        correctAns,
      })
      setCorrectAnswer(`Correct answer: ${correctAns}`)
      setGamePhase('reveal')
    })

    // Listen for Question events to update phase
    connection.on('Question', (qData) => {
      console.log('Question event received in operator dashboard:', qData)
      setGamePhase('question')
      setCorrectAnswer(null)
    })

    const setupConnection = async () => {
      if (connection.state === signalR.HubConnectionState.Disconnected) {
        await connection.start()
      }

      await connection.invoke('JoinOperatorGroup')

      // Also join the game group if a game is selected
      if (localGameId) {
        console.log('Operator joining game:', localGameId)
        await connection.invoke('JoinGame', localGameId, teamId)
        fetchScores(localGameId)
      }
    }

    setupConnection().catch(console.error)

    connection.onclose((err) => {
      console.log('Connection closed', err)
      setConnectionStatus('Disconnected')
    })

    connection.onreconnecting(() => {
      console.log('Reconnecting…')
      setConnectionStatus('Reconnecting…')
    })

    connection.onreconnected(() => {
      console.log('Reconnected')
      setConnectionStatus('Connected')
      setupConnection().catch(console.error)
    })

    return () => {
      // Connection cleanup is managed by App.jsx, so no stop here
    }
  }, [token, localGameId, connection, teamId])

  // Effect to handle initialGameId updates from parent
  useEffect(() => {
    setLocalGameId(initialGameId)
    if (
      initialGameId &&
      connection?.state === signalR.HubConnectionState.Connected
    ) {
      fetchScores(initialGameId)
      // Join the game group when gameId changes
      connection.invoke('JoinGame', initialGameId, teamId).catch(console.error)
    }
  }, [initialGameId, connection, teamId])

  const handleGameIdChange = (e) => {
    const newGameId = parseInt(e.target.value) || null
    setLocalGameId(newGameId)
    setGameId(newGameId)
    if (newGameId) fetchScores(newGameId)
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
          Game ID:
          <input
            type='number'
            value={localGameId || ''}
            onChange={handleGameIdChange}
            placeholder='Enter Game ID'
          />
        </label>
      </div>

      {correctAnswer && (
        <div>
          <h3>Current Answer</h3>
          <p>{correctAnswer}</p>
        </div>
      )}

      <h3>Team Scores</h3>
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
  setGameId: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  connection: PropTypes.object,
}

export default OperatorDashboard
