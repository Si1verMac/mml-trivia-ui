import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { jwtDecode } from 'jwt-decode'
import * as signalR from '@microsoft/signalr'
import PropTypes from 'prop-types'
import Confetti from 'react-confetti'

const Game = ({
  token,
  gameId,
  setGameId,
  onLogout,
  connection,
  isReconnecting,
  gameState,
  updateGameState,
}) => {
  const decoded = jwtDecode(token)
  const teamId = parseInt(decoded.teamId, 10)

  // UI state
  const [phase, setPhase] = useState(gameState.currentPhase || 'idle')
  const [round, setRound] = useState(gameState.question?.round || 1)
  const [questionNumber, setQuestionNumber] = useState(
    gameState.question?.questionNumber || 1
  )
  const [questionText, setQuestionText] = useState(
    gameState.question?.text || ''
  )
  const [answerOptions, setAnswerOptions] = useState(
    gameState.question?.options || []
  )
  const [selectedWager, setSelectedWager] = useState(null)
  const [answer, setAnswer] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [connectionError, setConnectionError] = useState(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [joinedTeams, setJoinedTeams] = useState([])
  const [activeGames, setActiveGames] = useState([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [hasSignaledReady, setHasSignaledReady] = useState(false)
  const [hasReceivedAnswer, setHasReceivedAnswer] = useState(false)
  const [answeredQuestions, setAnsweredQuestions] = useState(new Set())
  const [showOverlay, setShowOverlay] = useState(false)
  const [overlayMessage, setOverlayMessage] = useState('')
  const [isCorrect, setIsCorrect] = useState(false)
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [teamAnswerCorrect, setTeamAnswerCorrect] = useState(null)

  const timeoutRef = useRef(null)
  const eventsRegistered = useRef(false)

  // Sync App gameState with local UI state
  useEffect(() => {
    if (gameState.currentPhase !== phase) {
      console.log(
        `Updating local phase to ${gameState.currentPhase} from ${phase} (App gameState changed)`
      )
      setPhase(gameState.currentPhase)
    }

    if (gameState.question && gameState.question.text !== questionText) {
      console.log('Updating local question from App gameState')
      if (gameState.question.round) setRound(gameState.question.round)
      if (gameState.question.questionNumber)
        setQuestionNumber(gameState.question.questionNumber)
      if (gameState.question.text) setQuestionText(gameState.question.text)
      if (gameState.question.options)
        setAnswerOptions(gameState.question.options)
    }

    if (gameState.correctAnswer && gameState.correctAnswer !== '') {
      console.log(gameState.correctAnswer + 'Line 73')
      setHasReceivedAnswer(true)
    }
  }, [gameState, phase, questionText])

  // Set up SignalR events with stable dependencies
  useEffect(() => {
    if (!connection || !gameId || eventsRegistered.current) return

    console.log('Registering Game component event handlers')

    connection.on('GameStarted', (data) => {
      console.log('GameStarted event received:', data)
      changePhase('question')
    })

    connection.on('TeamJoined', ({ teamId: joinedId }) => {
      console.log(`Team ${joinedId} joined the game`)
      setJoinedTeams((prev) =>
        prev.includes(joinedId) ? prev : [...prev, joinedId]
      )
    })

    connection.on('GameState', (state) => {
      console.log('GameState received:', state)
      if (
        state.status === 'InProgress' &&
        (phase === 'idle' || phase === 'waiting')
      ) {
        changePhase('question')
      } else if (
        state.status === 'Created' &&
        phase !== 'question' &&
        phase !== 'reveal' &&
        phase !== 'waitingForAnswers'
      ) {
        changePhase('waiting')
      } else if (state.status === 'Ended') {
        changePhase('ended')
      }
    })

    connection.on('GameEnded', () => {
      console.log('GameEnded event')
      changePhase('ended')
      setTimeLeft(0)
    })

    connection.on('DisplayAnswer', (questionId, correctAnswer) => {
      console.log('DisplayAnswer event received:', questionId + correctAnswer)
      //const { questionId, correctAnswer } = data

      setCorrectAnswer(correctAnswer || '')

      console.log(correctAnswer + ' Line 128')

      // Ensure overlay uses current teamAnswerCorrect and selectedWager
      if (teamAnswerCorrect !== null) {
        setIsCorrect(teamAnswerCorrect)
        setOverlayMessage(
          teamAnswerCorrect
            ? `Congratulations! You won ${selectedWager || 0} points!`
            : `Ope! You lost ${selectedWager || 0}.`
        )
        setShowOverlay(true)
        setTimeout(() => {
          setShowOverlay(false)
          setTeamAnswerCorrect(null) // Clear after overlay hides
        }, 5000)
      }

      setAnsweredQuestions((prev) => {
        const updated = new Set(prev)
        updated.add(questionId)
        return updated
      })
      console.log('line149' + correctAnswer)
      updateGameState({
        currentQuestionId: questionId,
        correctAnswer: `${correctAnswer || ''}`,
        currentPhase: 'reveal',
      })
      console.log('Line155' + correctAnswer)
      setHasReceivedAnswer(true)
      setHasSignaledReady(false)
      setTimeLeft(0)

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    })

    connection.on('Question', (qData) => {
      console.log('Question event received:', qData)
      if (!qData || !qData.id) {
        console.error('Received invalid question data')
        return
      }
      const questionId = qData.id
      if (answeredQuestions.has(questionId)) {
        console.log(`Already answered question ${questionId}`)
        return
      }
      updateGameState({
        currentQuestionId: questionId,
        question: qData,
        correctAnswer: null,
        currentPhase: 'question',
      })
      setRound(qData.round || 1)
      setQuestionNumber(qData.questionNumber || 1)
      setQuestionText(qData.text || '')
      setSelectedWager(null) // Reset wager for new question
      setAnswer('')
      setHasReceivedAnswer(false)
      setHasSignaledReady(false)
      setShowOverlay(false) // Ensure overlay is off
      if (Array.isArray(qData.options)) {
        setAnswerOptions(qData.options)
      } else if (typeof qData.options === 'string') {
        try {
          setAnswerOptions(JSON.parse(qData.options))
        } catch (e) {
          console.error('Error parsing options:', e)
          setAnswerOptions([])
        }
      }
      setTimeLeft(150)
    })

    connection.on(
      'AnswerSubmitted',
      ({ teamId: submittedTeamId, isCorrect }) => {
        console.log(
          `Team ${submittedTeamId} answer submitted. Correct: ${isCorrect}`
        )
        if (submittedTeamId === teamId) {
          console.log('Our team submitted an answer')
          setTeamAnswerCorrect(isCorrect) // Set current correctness
          if (gameState.currentQuestionId) {
            setAnsweredQuestions((prev) => {
              const updated = new Set(prev)
              updated.add(gameState.currentQuestionId)
              return updated
            })
          }
          changePhase('waitingForAnswers')
        }
      }
    )

    connection.on('TeamSignaledReady', (readyTeamId) => {
      if (parseInt(readyTeamId, 10) === teamId && phase === 'reveal') {
        console.log(`Our team signaled ready`)
        setHasSignaledReady(true)
      }
    })

    eventsRegistered.current = true

    return () => {
      if (connection) {
        connection.off('GameStarted')
        connection.off('TeamJoined')
        connection.off('GameState')
        connection.off('GameEnded')
        connection.off('DisplayAnswer')
        connection.off('Question')
        connection.off('AnswerSubmitted')
        connection.off('TeamSignaledReady')
        eventsRegistered.current = false
        console.log('Unregistered Game component event handlers')
      }
    }
  }, [connection, gameId, selectedWager, gameState.currentQuestionId, phase])

  // Helper to change phase both locally and in App
  const changePhase = (newPhase) => {
    console.log(`Changing phase from ${phase} to ${newPhase}`)
    setPhase(newPhase)
    updateGameState({ currentPhase: newPhase })
  }

  // Fetch active games
  useEffect(() => {
    axios
      .get('https://localhost:7169/api/game/active', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((resp) => setActiveGames(resp.data))
      .catch((err) => console.error('Error fetching active games:', err))
  }, [token])

  // Join the game when connection is established
  useEffect(() => {
    if (!gameId || !connection) return

    const joinGameAsync = async () => {
      if (connection.state === signalR.HubConnectionState.Disconnected) {
        console.log('Connection is disconnected, waiting for reconnect')
        return
      }

      try {
        console.log(`Joining game ${gameId} as team ${teamId}`)
        await connection.invoke('JoinGame', gameId, teamId)
      } catch (err) {
        console.error('Error joining game:', err)
      }
    }

    joinGameAsync()
  }, [gameId, connection, teamId])

  // Handle reconnection status
  useEffect(() => {
    if (isReconnecting) {
      setConnectionError('Reconnecting...')
      setReconnecting(true)
    } else if (connection?.state === signalR.HubConnectionState.Connected) {
      setConnectionError(null)
      setReconnecting(false)
    }
  }, [isReconnecting, connection])

  // Timer logic
  useEffect(() => {
    let timer
    if (phase === 'question' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            changePhase('waitingForResults')
            if (connection?.state === signalR.HubConnectionState.Connected) {
              connection
                .invoke(
                  'HandleTimerExpiry',
                  gameId,
                  gameState.currentQuestionId
                )
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
  }, [phase, timeLeft, connection, gameId, gameState.currentQuestionId])

  // Check if we're stuck in waiting phase
  useEffect(() => {
    if (phase === 'waitingForAnswers' && !hasReceivedAnswer) {
      console.log('Setting up stuck check for waitingForAnswers phase')

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = setTimeout(() => {
        if (phase === 'waitingForAnswers' && !hasReceivedAnswer) {
          console.log(
            'Still waiting for answers after timeout, requesting game state'
          )
          if (connection?.state === signalR.HubConnectionState.Connected) {
            connection
              .invoke('RequestGameState', gameId, teamId)
              .catch((err) =>
                console.error('Error requesting game state:', err)
              )
          }
        }
      }, 5000)

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
      }
    }
  }, [phase, hasReceivedAnswer, connection, gameId, teamId])

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
      changePhase('waiting')
      setAnswer('')
      updateGameState({
        correctAnswer: null,
        currentQuestionId: null,
      })
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
    if (connection?.state === signalR.HubConnectionState.Connected) {
      connection
        .invoke('SubmitWager', gameId, teamId, val, gameState.currentQuestionId)
        .catch((err) => console.error('Error sending wager:', err))
    }
  }

  const submitAnswer = async () => {
    if (!connection || !gameId || !gameState.currentQuestionId) {
      console.error(
        'Cannot submit answer: Missing game, question, or connection'
      )
      return
    }

    if (!selectedWager) {
      alert('Please select a wager')
      return
    }

    if (!answer) {
      alert('Please select an answer')
      return
    }

    console.log(`Submitting answer for question ${gameState.currentQuestionId}`)

    try {
      await connection.invoke(
        'SubmitAnswer',
        gameId,
        teamId,
        gameState.currentQuestionId,
        answer,
        selectedWager
      )
      console.log('Answer submitted successfully')
      console.log('line 443' + answer)
    } catch (err) {
      console.error('Error submitting answer:', err)
    }
  }

  const signalReadyForNext = async () => {
    if (connection?.state === signalR.HubConnectionState.Connected) {
      try {
        console.log('Signaling ready for next question')
        await connection.invoke('SignalReadyForNext', gameId, teamId)
        setHasSignaledReady(true)
      } catch (err) {
        console.error('Error signaling ready:', err)
      }
    }
  }

  // Render based on phase
  if (!gameId) {
    return (
      <div className='game-container'>
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
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'waiting') {
    return (
      <div className='game-container'>
        <h2>Game {gameId}: Waiting</h2>
        <p>Teams joined: {joinedTeams.join(', ')}</p>
        <button onClick={startGame}>Start Game</button>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'waitingForAnswers') {
    return (
      <div className='game-container'>
        <h2>Game {gameId}: Waiting for other teams</h2>
        <h3>
          Round {round}: Question {questionNumber}
        </h3>
        <p>You&apos;ve submitted your answer.</p>
        <p>Waiting for other teams to submit their answers...</p>
        {hasReceivedAnswer ? (
          <div className='answer-display'>
            <h3>{gameState.correctAnswer}</h3>
          </div>
        ) : (
          <div className='spinner-border' role='status'>
            <span className='visually-hidden'>Loading...</span>
          </div>
        )}
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'idle') {
    return (
      <div className='game-container'>
        <h2>Game {gameId}: Idle</h2>
        <button onClick={startGame}>Start Game</button>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (connectionError) {
    return (
      <div className='game-container'>
        <h2>Error</h2>
        <p>{connectionError}</p>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'question') {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>
          Round {round}: Question {questionNumber}
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
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'waitingForResults') {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>
          Round {round}: Question {questionNumber}
        </h3>
        <p>Your answer has been submitted. Waiting for results…</p>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'reveal') {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>
          Round {round}: Question {questionNumber} Results
        </h3>
        <br />

        {correctAnswer && (
          <p>
            <b>Correct Answer:</b> {correctAnswer}
          </p>
        )}
        {showOverlay && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: isCorrect
                ? 'rgba(0, 255, 0, 0.5)'
                : 'rgba(255, 0, 0, 0.5)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 1000,
            }}
          >
            <h2 className='overlay_message'>{overlayMessage}</h2>
            {isCorrect && <Confetti />}
          </div>
        )}
        <br />
        <br />
        <p>Waiting for teams to signal ready...</p>
        <button
          className='next_question_button'
          onClick={signalReadyForNext}
          disabled={hasSignaledReady}
          style={{
            backgroundColor: hasSignaledReady ? '#4CAF50' : '',
            color: hasSignaledReady ? 'white' : '',
          }}
        >
          {hasSignaledReady ? 'Ready!' : 'Ready for Next Question'}
        </button>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'ended') {
    return (
      <div className='game-container'>
        <h2>Game Over</h2>
        <p>The game has ended. Thanks for playing!</p>
        <button
          onClick={() => {
            setGameId(null)
            changePhase('idle')
          }}
        >
          Back to Lobby
        </button>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  return (
    <div className='game-container'>
      <p>Loading…</p>
      <button className='logout_button' onClick={onLogout}>
        Logout
      </button>
    </div>
  )
}

Game.propTypes = {
  token: PropTypes.string.isRequired,
  gameId: PropTypes.number,
  setGameId: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  connection: PropTypes.object,
  isReconnecting: PropTypes.bool,
  gameState: PropTypes.object.isRequired,
  updateGameState: PropTypes.func.isRequired,
}

export default Game
