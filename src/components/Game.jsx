import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { jwtDecode } from 'jwt-decode'
import * as signalR from '@microsoft/signalr'
import PropTypes from 'prop-types'

const Game = ({ token, gameId, setGameId, onLogout, connection }) => {
  const decoded = jwtDecode(token)
  const teamId = parseInt(decoded.teamId, 10)

  const [phase, setPhase] = useState('idle')
  const [round, setRound] = useState(1)
  const [questionNumber, setQuestionNumber] = useState(1)
  const [questionText, setQuestionText] = useState('')
  const [answerOptions, setAnswerOptions] = useState([])
  const [currentQuestionId, setCurrentQuestionId] = useState(null)
  const [selectedWager, setSelectedWager] = useState(null)
  const [answer, setAnswer] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [connectionError, setConnectionError] = useState(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [joinedTeams, setJoinedTeams] = useState([])
  const [activeGames, setActiveGames] = useState([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [hasSignaledReady, setHasSignaledReady] = useState(false)
  const [hasReceivedAnswer, setHasReceivedAnswer] = useState(false)

  // Track whether the component is mounted
  const isMounted = useRef(true)
  // Track the last processed question ID to avoid duplicates
  const lastProcessedQuestionId = useRef(null)

  // Clean up function to run when unmounting
  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  // Helper function to reset the ready state
  const resetReadyState = () => {
    console.log('Explicitly resetting ready state')
    setHasSignaledReady(false)
  }

  const hubConnectionRef = useRef(null)
  const timeoutRef = useRef(null)

  // Fetch active games
  useEffect(() => {
    axios
      .get('https://localhost:7169/api/game/active', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((resp) => setActiveGames(resp.data))
      .catch((err) => console.error('Error fetching active games:', err))
  }, [token])

  // Set up SignalR connection and event handlers
  useEffect(() => {
    if (!gameId || !connection) return

    hubConnectionRef.current = connection

    const setupConnection = async () => {
      if (connection.state === signalR.HubConnectionState.Disconnected) {
        await connection.start()
      }
      await connection.invoke('JoinGame', gameId, teamId)
    }

    connection.on('GameStarted', (data) => {
      console.log('GameStarted event received:', data)
      setPhase('question')
    })

    connection.on('TeamJoined', ({ teamId: joinedId }) => {
      console.log(`Team ${joinedId} joined the game`)
      setJoinedTeams((prev) =>
        prev.includes(joinedId) ? prev : [...prev, joinedId]
      )
      // Don't change phase here as it may override the current state
      // The GameState event will set the correct phase
    })

    connection.on('Question', (qData) => {
      console.log('Question event received:', qData)
      if (!qData) {
        console.error('Question data is empty or undefined')
        return
      }

      // Reset the last processed question ID when we get a new question
      lastProcessedQuestionId.current = null

      setRound(qData.round || 1)
      setQuestionNumber(qData.questionNumber || 1)
      setQuestionText(qData.text || '')

      // Handle options correctly whether they're an array or a string
      if (Array.isArray(qData.options)) {
        setAnswerOptions(qData.options)
      } else if (typeof qData.options === 'string') {
        try {
          setAnswerOptions(JSON.parse(qData.options))
        } catch (e) {
          console.error('Error parsing options:', e)
          setAnswerOptions([])
        }
      } else {
        setAnswerOptions([])
      }

      setCurrentQuestionId(qData.id || null)
      setSelectedWager(null)
      setAnswer('')
      setCorrectAnswer(null)
      setPhase('question')
      setTimeLeft(150) // 2.5 minutes

      // IMPORTANT: Reset the hasSignaledReady state when a new question arrives
      console.log('Resetting hasSignaledReady to false for new question')
      resetReadyState()
      setHasReceivedAnswer(false)
    })

    // Move the DisplayAnswer event handling to the top level to ensure highest priority
    connection.on('DisplayAnswer', (qId, correctAns) => {
      console.log('DisplayAnswer event received:', {
        qId,
        correctAns,
        currentPhase: phase,
        lastProcessedId: lastProcessedQuestionId.current,
      })

      // Avoid processing the same question twice
      if (lastProcessedQuestionId.current === qId) {
        console.log(
          `Ignoring duplicate DisplayAnswer event for question ${qId}`
        )
        return
      }

      lastProcessedQuestionId.current = qId

      // No matter what phase we're in, ensure we show the answer
      setCorrectAnswer(`Correct answer: ${correctAns}`)
      setHasReceivedAnswer(true)

      // ALWAYS reset the hasSignaledReady state when showing a new answer
      resetReadyState()

      // Set phase to reveal, overriding any other phase
      console.log(`Setting phase to reveal from ${phase}`)
      setPhase('reveal')
      setTimeLeft(0)

      // Clear any waiting timeouts to ensure we don't have conflicts
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    })

    connection.on('AnswerSubmitted', ({ teamId, isCorrect }) => {
      console.log(`Team ${teamId} answer submitted. Correct: ${isCorrect}`)
      if (teamId === parseInt(decoded.teamId, 10)) {
        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }

        // Set phase to waitingForAnswers
        setPhase('waitingForAnswers')

        // Add a small delay to ensure DisplayAnswer event can be processed
        // even if it comes immediately after this
        timeoutRef.current = setTimeout(() => {
          // If we're still in waitingForAnswers phase after 100ms,
          // keep it that way - no DisplayAnswer has arrived yet
          console.log('Checking if DisplayAnswer event was received...')
        }, 100)
      }
    })

    connection.on('ScoresUpdated', (scoresupdated) => {
      console.log('Received scores:', scoresupdated)
    })

    connection.on('GameState', (state) => {
      console.log('GameState received:', state)
      // Update phase based on game status
      if (state.status === 'InProgress') {
        setPhase('question')
      } else if (state.status === 'Created') {
        setPhase('waiting')
      } else if (state.status === 'Ended') {
        setPhase('ended')
      }
    })

    connection.on('GameEnded', () => {
      console.log('GameEnded event')
      setPhase('ended')
      setTimeLeft(0)
    })

    connection.onclose(() => {
      console.error('Connection closed')
      setConnectionError('Connection closed')
      setReconnecting(true)
    })

    connection.onreconnecting(() => {
      console.log('Reconnecting…')
      setReconnecting(true)
    })

    connection.onreconnected(() => {
      console.log('Reconnected')
      setReconnecting(false)
      setConnectionError(null)
      connection.invoke('JoinGame', gameId, teamId).catch(console.error)
      axios
        .get(`https://localhost:7169/api/game/${gameId}/state`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((response) => {
          const { currentRound, currentQuestionNumber } = response.data
          setRound(currentRound)
          setQuestionNumber(currentQuestionNumber)
          if (connection.state === signalR.HubConnectionState.Connected) {
            axios
              .get(`https://localhost:7169/api/game/${gameId}/state`, {
                headers: { Authorization: `Bearer ${token}` },
              })
              .then((resp) => {
                const game = resp.data
                if (game.currentQuestionId) {
                  connection.invoke('JoinGame', gameId, teamId)
                }
              })
          }
        })
        .catch((err) => console.error('Error fetching game state:', err))
    })

    setupConnection().catch((err) => {
      console.error('SignalR setup error:', err)
      setConnectionError(err.message)
      setReconnecting(true)
    })

    return () => {
      // Connection cleanup managed by App.jsx
    }
  }, [gameId, token, teamId, connection])

  // Timer logic
  useEffect(() => {
    let timer
    if (phase === 'question' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            setPhase('waitingForResults')
            if (
              connection &&
              connection.state === signalR.HubConnectionState.Connected
            ) {
              connection
                .invoke('HandleTimerExpiry', gameId, currentQuestionId)
                .catch((err) =>
                  console.error('Error invoking HandleTimerExpiry:', err)
                )
            }
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [phase, timeLeft, connection, gameId, currentQuestionId])

  // Monitor for stuck in waitingForAnswers state
  useEffect(() => {
    if (phase === 'waitingForAnswers') {
      // After 2 seconds in waitingForAnswers, assume we might have missed an event
      const timer = setTimeout(() => {
        console.log(
          'Still in waitingForAnswers phase after 2 seconds, requesting current game state'
        )
        if (
          connection &&
          connection.state === signalR.HubConnectionState.Connected
        ) {
          // Request the current game state to ensure we're in sync
          connection
            .invoke('RequestGameState', gameId, teamId)
            .catch((err) => console.error('Error requesting game state:', err))
        }
      }, 2000)

      return () => clearTimeout(timer)
    }
  }, [phase, connection, gameId, teamId])

  // Periodically check if we should be in the reveal phase
  useEffect(() => {
    // Extra check to ensure we don't get stuck in waitingForAnswers
    if (phase === 'waitingForAnswers' && hasReceivedAnswer) {
      console.log(
        'Detected inconsistency: received answer but still in waitingForAnswers phase, forcing to reveal phase'
      )
      setPhase('reveal')
    }
  }, [phase, hasReceivedAnswer])

  const joinGame = async () => {
    try {
      const payload = {
        teamIds: [teamId],
        gameId: selectedGameId ? parseInt(selectedGameId, 10) : null,
      }
      const resp = await axios.post(
        'https://localhost:7169/api/game/join',
        payload,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const newGameId = resp.data.gameId
      setGameId(newGameId)
      setPhase('waiting')
      setAnswer('')
      setCorrectAnswer(null)
      setTimeLeft(0)
      setJoinedTeams([teamId])
    } catch (error) {
      console.error('joinGame error:', error)
      alert(error.response?.data?.error || error.message)
    }
  }

  const startGame = async () => {
    try {
      await axios.post(
        'https://localhost:7169/api/game/start',
        { gameId },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
    } catch (err) {
      console.error('startGame error:', err)
      alert(err.response?.data?.error || err.message)
    }
  }

  const handleWagerSelect = (val) => {
    setSelectedWager(val)
    if (
      connection &&
      connection.state === signalR.HubConnectionState.Connected
    ) {
      connection
        .invoke('SubmitWager', gameId, teamId, val, currentQuestionId)
        .catch((err) => console.error('Error sending wager:', err))
    }
  }

  const submitAnswer = async () => {
    if (!currentQuestionId || !answer) {
      alert('You must select an answer.')
      return
    }
    if (!selectedWager) {
      alert('Select a wager first.')
      return
    }
    if (
      !connection ||
      connection.state !== signalR.HubConnectionState.Connected
    ) {
      alert('Not connected to the hub.')
      return
    }
    try {
      await connection.invoke(
        'SubmitAnswer',
        gameId,
        teamId,
        currentQuestionId,
        answer,
        selectedWager
      )

      setTimeLeft(0)

      // Only set the phase to waitingForAnswers if we haven't received an answer yet
      if (!hasReceivedAnswer) {
        setPhase('waitingForAnswers')
      } else {
        // If we've already received an answer, go straight to reveal
        setPhase('reveal')
      }
    } catch (error) {
      console.error('SubmitAnswer error:', error)
    }
  }

  const signalReadyForNext = async () => {
    if (
      connection &&
      connection.state === signalR.HubConnectionState.Connected
    ) {
      try {
        console.log('Signaling ready for next question - user clicked button')
        // Only mark as signaled if the call succeeds
        await connection.invoke('SignalReadyForNext', gameId, teamId)
        console.log(
          'Successfully signaled ready for next question, setting button state'
        )
        setHasSignaledReady(true)
      } catch (error) {
        console.error('Error signaling ready:', error)
        // Don't update hasSignaledReady if there was an error
      }
    }
  }

  // Add a listener for a new event "TeamSignaledReady" to show which teams have signaled ready
  useEffect(() => {
    // This effect sets up a listener for the TeamSignaledReady event
    if (!connection) return

    const handleTeamSignaledReady = (readyTeamId) => {
      console.log(`Team ${readyTeamId} signaled ready`)
      // If it's our team, update our UI state, but only if we're in the reveal phase
      // This prevents automatically disabling the button when not needed
      if (readyTeamId === teamId) {
        console.log(`Our team ${teamId} signaled ready`)

        // If we're in the reveal phase, update the button
        if (phase === 'reveal') {
          console.log(`We're in reveal phase, setting hasSignaledReady to true`)
          setHasSignaledReady(true)
        } else {
          console.log(
            `We're not in reveal phase (${phase}), NOT setting hasSignaledReady`
          )
        }
      } else {
        console.log(
          `Team ${readyTeamId} signaled ready, but we're team ${teamId}, not updating button state`
        )
      }
    }

    connection.on('TeamSignaledReady', handleTeamSignaledReady)

    return () => {
      // Clean up when the component unmounts or connection changes
      connection.off('TeamSignaledReady', handleTeamSignaledReady)
    }
  }, [connection, teamId, phase])

  // Add an effect to force reset hasSignaledReady when entering reveal phase
  useEffect(() => {
    if (phase === 'reveal' && !hasReceivedAnswer) {
      // If we just entered the reveal phase but haven't received an answer,
      // make sure we reset the ready state
      console.log(
        'Entered reveal phase - explicitly ensuring ready button is enabled'
      )
      resetReadyState()
    }
  }, [phase, hasReceivedAnswer])

  // Conditional rendering based on phase
  if (!gameId) {
    return (
      <div>
        <h2>Join or Create a Game</h2>
        <label>
          Existing Game:
          <select
            value={selectedGameId}
            onChange={(e) => setSelectedGameId(e.target.value)}
          >
            <option value=''>Create New Game</option>
            {activeGames.map((g) => (
              <option key={g.id} value={g.id}>
                Game {g.id} - created at{' '}
                {new Date(g.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <button onClick={joinGame}>Join Game</button>
        {connectionError && <p style={{ color: 'red' }}>{connectionError}</p>}
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'waiting') {
    return (
      <div>
        <h2>Game {gameId}: Waiting</h2>
        <p>Teams joined: {joinedTeams.join(', ')}</p>
        <button onClick={startGame}>Start Game</button>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'waitingForAnswers') {
    return (
      <div>
        <h2>Game {gameId}: Waiting for other teams</h2>
        <h3>
          Round {round} – Question {questionNumber}
        </h3>
        <p>You&apos;ve submitted your answer.</p>
        <p>Waiting for other teams to submit their answers...</p>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'idle') {
    return (
      <div>
        <h2>Game {gameId}: Idle</h2>
        <button onClick={startGame}>Start Game</button>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (connectionError) {
    return (
      <div>
        <h2>Error</h2>
        <p>{connectionError}</p>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'question') {
    return (
      <div>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>
          Round {round} – Question {questionNumber}
        </h3>
        <p>
          <strong>{questionText}</strong>
        </p>
        <div>
          <p>Select your wager:</p>
          {[1, 3, 5].map((w) => (
            <button
              key={w}
              onClick={() => handleWagerSelect(w)}
              style={{ fontWeight: selectedWager === w ? 'bold' : 'normal' }}
            >
              {w} pts
            </button>
          ))}
        </div>
        <p>Selected wager: {selectedWager || 0}</p>
        <div>
          <p>Choose your answer:</p>
          {answerOptions.map((opt) => (
            <label key={opt} style={{ display: 'block' }}>
              <input
                type='radio'
                name='answerChoice'
                value={opt}
                checked={answer === opt}
                onChange={() => setAnswer(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
        <button onClick={submitAnswer} disabled={!answer || !selectedWager}>
          Submit Answer
        </button>
        <p>Time remaining: {timeLeft} seconds</p>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'waitingForResults') {
    return (
      <div>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>
          Round {round} – Question {questionNumber}
        </h3>
        <p>Your answer has been submitted. Waiting for results…</p>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'reveal') {
    return (
      <div>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>
          Round {round} – Question {questionNumber} Results
        </h3>
        {correctAnswer && <p>{correctAnswer}</p>}
        <p>Waiting for the host to trigger the next question…</p>
        <button
          onClick={signalReadyForNext}
          disabled={hasSignaledReady}
          style={{
            backgroundColor: hasSignaledReady ? '#4CAF50' : '',
            color: hasSignaledReady ? 'white' : '',
          }}
        >
          {hasSignaledReady ? 'Ready!' : 'Ready for Next Question'}
        </button>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'ended') {
    return (
      <div>
        <h2>Game Over</h2>
        <p>The game has ended. Thanks for playing!</p>
        <button
          onClick={() => {
            setGameId(null)
            setPhase('idle')
          }}
        >
          Back to Lobby
        </button>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  return (
    <div>
      <p>Loading…</p>
      <button onClick={onLogout}>Logout</button>
    </div>
  )
}

Game.propTypes = {
  token: PropTypes.string.isRequired,
  gameId: PropTypes.number,
  setGameId: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  connection: PropTypes.object,
}

export default Game
