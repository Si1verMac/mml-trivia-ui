import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import * as signalR from '@microsoft/signalr'
import PropTypes from 'prop-types'
import { jwtDecode } from 'jwt-decode'

const Game = ({ token, setGameId, gameId, onLogout }) => {
  const decodedToken = jwtDecode(token)
  const teamId = parseInt(decodedToken.teamId)

  // State variables for game flow and UI
  const [phase, setPhase] = useState('idle') // idle, wager, waitingForQuestion, question, waitingForResults, reveal
  const [round, setRound] = useState(1)
  const [questionNumber, setQuestionNumber] = useState(1)
  const [selectedWager, setSelectedWager] = useState(null)
  const [wagerSubmitted, setWagerSubmitted] = useState(false)
  const [questionText, setQuestionText] = useState('')
  const [answerOptions, setAnswerOptions] = useState([])
  const [answer, setAnswer] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState(null)
  const [currentQuestionId, setCurrentQuestionId] = useState(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [connectionError, setConnectionError] = useState(null)
  const [reconnecting, setReconnecting] = useState(false)

  // useRef for the SignalR connection and join status
  const hubConnectionRef = useRef(null)
  const joinedGamesRef = useRef({})

  // SignalR connection setup – runs when gameId, token, or teamId change
  useEffect(() => {
    if (!gameId) return

    // If we already have a connection and have joined this game, skip setup
    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state === signalR.HubConnectionState.Connected &&
      joinedGamesRef.current[gameId]
    ) {
      console.log(
        `Team ${teamId} already joined game ${gameId}, skipping setup`
      )
      setPhase('wager')
      return
    }

    // Stop any existing connection before starting a new one
    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state !== signalR.HubConnectionState.Disconnected
    ) {
      hubConnectionRef.current
        .stop()
        .then(() => console.log('Previous connection stopped before new setup'))
        .catch((err) =>
          console.error('Error stopping previous connection:', err)
        )
      hubConnectionRef.current = null
    }

    // Create a new connection – forcing LongPolling to avoid WebSocket issues
    const connection = new signalR.HubConnectionBuilder()
      .withUrl('https://localhost:7169/triviaHub', {
        accessTokenFactory: () => token,
        transport: signalR.HttpTransportType.LongPolling,
      })
      .configureLogging(signalR.LogLevel.Information)
      .withAutomaticReconnect()
      .build()

    console.log('Creating SignalR connection, state:', connection.state)

    // Event handlers
    connection.on('TeamJoined', (gameTeam) => {
      console.log('TeamJoined:', gameTeam)
      joinedGamesRef.current[gameId] = true
      setPhase('wager')
      setConnectionError(null)
      setReconnecting(false)
    })

    connection.on('WagerSubmitted', (data) => {
      console.log('WagerSubmitted event received:', data)
      // We do not auto-advance here; we wait for "AllWagersIn"
    })

    connection.on('Question', (questionData) => {
      console.log('Question:', questionData)
      setQuestionText(questionData.text ?? '')
      setAnswerOptions(questionData.options ?? [])
      setAnswer('')
      setCorrectAnswer(null)
      setTimeLeft(150)
      setPhase('question')
      setCurrentQuestionId(questionData.id ?? null)
      // Reset wager submission for the new question
      setWagerSubmitted(false)
      setSelectedWager(null)
    })

    connection.on('DisplayAnswer', (questionId, correctAns) => {
      console.log('DisplayAnswer:', { questionId, correctAns })
      setCorrectAnswer(
        `The correct answer for question ${questionId} is: ${correctAns}`
      )
      setPhase('reveal')
      setTimeLeft(0)
    })

    connection.on('Error', (message) => {
      console.error('Error from hub:', message)
      if (message.includes('has already joined')) {
        console.log(`Team ${teamId} already in game ${gameId}, proceeding`)
        joinedGamesRef.current[gameId] = true
        setPhase('wager')
        setConnectionError(null)
        setReconnecting(false)
      } else {
        setConnectionError(message)
      }
    })

    connection.on('AllWagersIn', () => {
      console.log('All wagers received, proceeding...')
      setPhase('waitingForQuestion')
    })

    connection.onclose((err) => {
      console.error('Connection closed:', err)
      setConnectionError('Connection closed unexpectedly')
      hubConnectionRef.current = null
      setReconnecting(true)
    })

    connection.onreconnecting((err) => {
      console.log('Reconnecting:', err)
      setConnectionError('Reconnecting to hub...')
      setReconnecting(true)
    })

    connection.onreconnected(() => {
      console.log('Reconnected')
      setConnectionError(null)
      setReconnecting(false)
      if (!joinedGamesRef.current[gameId]) {
        connection
          .invoke('JoinGame', gameId, teamId)
          .catch((err) => console.error('Failed to invoke JoinGame:', err))
      } else {
        setPhase('wager')
      }
    })

    const handleJoinError = (err) => {
      console.error('Failed to invoke JoinGame:', err)
      if (err.message && err.message.includes('has already joined')) {
        console.log(
          `Team ${teamId} already in game ${gameId} (from catch), proceeding`
        )
        joinedGamesRef.current[gameId] = true
        setPhase('wager')
        setConnectionError(null)
        setReconnecting(false)
      } else {
        setConnectionError('Failed to join game: ' + err.message)
        setReconnecting(true)
      }
    }

    const startConnection = () => {
      console.log('Attempting to start SignalR connection...')
      connection
        .start()
        .then(() => {
          console.log('Connected to SignalR hub')
          hubConnectionRef.current = connection
          setConnectionError(null)
          setReconnecting(false)
          connection.invoke('JoinGame', gameId, teamId).catch(handleJoinError)
        })
        .catch((err) => {
          console.error('SignalR connection error:', err)
          setConnectionError('Failed to connect to hub: ' + err.message)
          setReconnecting(true)
          setTimeout(startConnection, 5000)
        })
    }
    startConnection()
  }, [gameId, token, teamId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (
        hubConnectionRef.current &&
        hubConnectionRef.current.state !==
          signalR.HubConnectionState.Disconnected
      ) {
        hubConnectionRef.current
          .stop()
          .then(() => console.log('Connection stopped on unmount'))
          .catch((err) => console.error('Error stopping connection:', err))
        hubConnectionRef.current = null
      }
    }
  }, [])

  // Timer effect for question phase
  useEffect(() => {
    let timerId
    if (phase === 'question' && timeLeft > 0) {
      timerId = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerId)
            if (phase === 'question') setPhase('waitingForResults')
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(timerId)
  }, [phase, timeLeft])

  // Auto-advance in single-team scenario
  useEffect(() => {
    if (phase === 'waitingForQuestion') {
      const timeout = setTimeout(() => {
        if (
          hubConnectionRef.current &&
          hubConnectionRef.current.state ===
            signalR.HubConnectionState.Connected
        ) {
          console.log('Auto-invoking ReadyForNextQuestion')
          hubConnectionRef.current
            .invoke(
              'ReadyForNextQuestion',
              gameId,
              teamId,
              round,
              questionNumber
            )
            .catch((err) =>
              console.error('Error invoking ReadyForNextQuestion:', err)
            )
        }
      }, 3000)
      return () => clearTimeout(timeout)
    }
  }, [phase, gameId, teamId, round, questionNumber])

  // Function to join an open game (using the join endpoint)
  const joinGame = async () => {
    try {
      const response = await axios.post(
        'https://localhost:7169/api/game/join',
        { teamIds: [teamId] },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      console.log('Join Game Response:', response.data)
      const newGameId = response.data.gameId
      setGameId(newGameId)
      // Reset states for new game
      setRound(1)
      setQuestionNumber(1)
      setSelectedWager(null)
      setWagerSubmitted(false)
      setPhase('idle')
      setAnswer('')
      setCorrectAnswer(null)
      setConnectionError(null)
      setReconnecting(false)
      // Clear previous join status using the new gameId
      delete joinedGamesRef.current[newGameId]
      // Stop any active connection
      if (
        hubConnectionRef.current &&
        hubConnectionRef.current.state !==
          signalR.HubConnectionState.Disconnected
      ) {
        await hubConnectionRef.current.stop()
        console.log('Connection stopped before new game')
        hubConnectionRef.current = null
      }
    } catch (error) {
      alert(
        `Failed to join game: ${error.response?.data?.error || error.message}`
      )
    }
  }

  // Function to start the game (using the start endpoint)
  const startGame = async () => {
    try {
      const response = await axios.post(
        'https://localhost:7169/api/game/start',
        { gameId },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      console.log('Start Game Response:', response.data)
    } catch (error) {
      alert(
        `Failed to start game: ${error.response?.data?.error || error.message}`
      )
    }
  }

  // Handle wager selection
  const handleWagerSelect = (wagerValue) => {
    if (wagerSubmitted) return // Prevent duplicate submission.
    setSelectedWager(wagerValue)
    setWagerSubmitted(true)
    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state === signalR.HubConnectionState.Connected
    ) {
      hubConnectionRef.current
        .invoke('SubmitWager', gameId, teamId, wagerValue, questionNumber)
        .catch((err) => console.error('Error sending wager:', err))
    }
  }

  // Submit answer via Axios API call (which upserts the answer record)
  const submitAnswer = async () => {
    if (!answer) {
      alert('Please select an answer.')
      return
    }
    try {
      await axios.post(
        'https://localhost:7169/api/game/submit-answer',
        {
          gameId,
          teamId,
          questionId: currentQuestionId,
          selectedAnswer: answer,
          wager: selectedWager,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setPhase('waitingForResults')
      setTimeLeft(0)
      console.log('Answer submitted:', answer, '(wager:', selectedWager, ')')
    } catch (error) {
      alert(
        `Failed to submit answer: ${
          error.response?.data?.error || error.message
        }`
      )
    }
  }

  // Proceed to next question or round
  const goToNextQuestion = () => {
    let nextQuestionNum = questionNumber + 1
    let nextRound = round
    if (questionNumber >= 3) {
      nextRound = round + 1
      nextQuestionNum = 1
    }
    setRound(nextRound)
    setQuestionNumber(nextQuestionNum)
    setSelectedWager(null)
    setAnswer('')
    setCorrectAnswer(null)
    // Reset wager submission flag for new question.
    setWagerSubmitted(false)
    setPhase('wager')
    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state === signalR.HubConnectionState.Connected
    ) {
      hubConnectionRef.current
        .invoke(
          'ReadyForNextQuestion',
          gameId,
          teamId,
          nextRound,
          nextQuestionNum
        )
        .catch((err) => console.error('Error notifying ready:', err))
    }
  }

  // Render UI based on game phase
  let content
  if (!gameId) {
    content = <button onClick={joinGame}>Join Game</button>
  } else if (phase === 'idle') {
    content = (
      <div>
        <p>Game ID: {gameId}</p>
        <button onClick={startGame}>Start Game</button>
      </div>
    )
  } else if (connectionError) {
    content = <p>Error: {connectionError}</p>
  } else {
    switch (phase) {
      case 'wager':
        content = (
          <div className='wager-phase'>
            <h3>
              Round {round} – Question {questionNumber}: Select your wager
            </h3>
            <div>
              {[1, 3, 5].map((value) => (
                <button
                  key={value}
                  onClick={() => handleWagerSelect(value)}
                  disabled={wagerSubmitted}
                >
                  {value} {value === 1 ? 'point' : 'points'}
                </button>
              ))}
            </div>
          </div>
        )
        break
      case 'waitingForQuestion':
        content = (
          <div className='waiting-screen'>
            <h3>
              Round {round} – Question {questionNumber}
            </h3>
            <p>Wager placed: {selectedWager} points.</p>
            <p>Waiting for other teams to submit wagers...</p>
          </div>
        )
        break
      case 'question':
        content = (
          <div className='question-phase'>
            <h3>
              Round {round} – Question {questionNumber}
            </h3>
            <p>
              <strong>{questionText}</strong>
            </p>
            <div className='options-list'>
              {answerOptions.map((opt, idx) => (
                <div key={idx}>
                  <label>
                    <input
                      type='radio'
                      name='answerOption'
                      value={opt}
                      checked={answer === opt}
                      onChange={() => setAnswer(opt)}
                    />
                    {opt}
                  </label>
                </div>
              ))}
            </div>
            <button onClick={submitAnswer} disabled={!answer}>
              Submit Answer
            </button>
            <div className='timer'>Time remaining: {timeLeft} seconds</div>
          </div>
        )
        break
      case 'waitingForResults':
        content = (
          <div className='waiting-screen'>
            <h3>
              Round {round} – Question {questionNumber}
            </h3>
            <p>Your answer has been submitted!</p>
            <p>Waiting for other teams to submit answers...</p>
          </div>
        )
        break
      case 'reveal':
        content = (
          <div className='reveal-phase'>
            <h3>
              Round {round} – Question {questionNumber} Results
            </h3>
            {correctAnswer && <p>{correctAnswer}</p>}
            <button onClick={goToNextQuestion}>
              {questionNumber < 3 ? 'Next Question' : 'Next Round'}
            </button>
          </div>
        )
        break
      default:
        content = <p>Loading...</p>
    }
  }

  return (
    <div className='game-container'>
      <h2>Trivia Game</h2>
      {reconnecting && <div className='reconnecting-banner'>Reconnecting…</div>}
      {content}
      <button onClick={onLogout} className='logout-btn'>
        Logout
      </button>
    </div>
  )
}

Game.propTypes = {
  token: PropTypes.string.isRequired,
  setGameId: PropTypes.func.isRequired,
  gameId: PropTypes.number,
  onLogout: PropTypes.func.isRequired,
}

export default Game
