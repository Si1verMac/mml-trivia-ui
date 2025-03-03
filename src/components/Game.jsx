import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import * as signalR from '@microsoft/signalr'
import PropTypes from 'prop-types'
import { jwtDecode } from 'jwt-decode'

const Game = ({ token, setGameId, gameId, onLogout }) => {
  const decodedToken = jwtDecode(token)
  const teamId = parseInt(decodedToken.teamId)

  const [phase, setPhase] = useState('idle')
  const [round, setRound] = useState(1)
  const [questionNumber, setQuestionNumber] = useState(1)
  const [usedWagers, setUsedWagers] = useState([])
  const [selectedWager, setSelectedWager] = useState(null)
  const [questionText, setQuestionText] = useState('')
  const [answerOptions, setAnswerOptions] = useState([])
  const [answer, setAnswer] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState(null)
  const [currentQuestionId, setCurrentQuestionId] = useState(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [connectionError, setConnectionError] = useState(null)
  const [hubConnection, setHubConnection] = useState(null)
  const [reconnecting, setReconnecting] = useState(false)

  // Use ref to track join status per gameId
  const joinedGamesRef = useRef({})

  // SignalR connection setup with reconnection logic
  useEffect(() => {
    if (!gameId) return

    // Reuse existing connection if connected and joined
    if (
      hubConnection &&
      hubConnection.state === signalR.HubConnectionState.Connected &&
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
      hubConnection &&
      hubConnection.state !== signalR.HubConnectionState.Disconnected
    ) {
      hubConnection
        .stop()
        .then(() => console.log('Previous connection stopped before new setup'))
        .catch((err) =>
          console.error('Error stopping previous connection:', err)
        )
    }

    const connection = new signalR.HubConnectionBuilder()
      .withUrl('https://localhost:7169/triviaHub', {
        accessTokenFactory: () => token,
      })
      .configureLogging(signalR.LogLevel.Information)
      .withAutomaticReconnect() // Enables automatic reconnection with default retry intervals
      .build()

    console.log('Creating SignalR connection, state:', connection.state)

    // Event handlers
    connection.on('TeamJoined', (gameTeam) => {
      console.log('Team Joined:', gameTeam)
      joinedGamesRef.current[gameId] = true
      setPhase('wager')
      setConnectionError(null)
      setReconnecting(false)
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
      console.log('AllWagersIn received')
    })

    // Handle permanent disconnect
    connection.onclose((err) => {
      console.error('Connection closed:', err)
      setConnectionError('Connection closed unexpectedly')
      setHubConnection(null)
      setReconnecting(true)
    })

    // Handle reconnection attempt
    connection.onreconnecting((err) => {
      console.log('Reconnecting:', err)
      setConnectionError('Reconnecting to hub...')
      setReconnecting(true)
    })

    // Handle successful reconnection
    connection.onreconnected(() => {
      console.log('Reconnected')
      setConnectionError(null)
      setReconnecting(false)
      if (!joinedGamesRef.current[gameId]) {
        console.log('Reconnected, invoking JoinGame:', { gameId, teamId })
        connection.invoke('JoinGame', gameId, teamId).catch(handleJoinError)
      } else {
        console.log(
          `Team ${teamId} already joined game ${gameId}, skipping JoinGame`
        )
        setPhase('wager')
      }
    })

    // Centralized error handler for JoinGame invocation
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

    // Start the connection with manual retry for initial failure
    const startConnection = () => {
      console.log('Attempting to start SignalR connection...')
      connection
        .start()
        .then(() => {
          console.log('Connected to SignalR hub')
          setHubConnection(connection)
          setConnectionError(null)
          setReconnecting(false)
          if (!joinedGamesRef.current[gameId]) {
            console.log('Invoking JoinGame:', { gameId, teamId })
            connection.invoke('JoinGame', gameId, teamId).catch(handleJoinError)
          } else {
            console.log(
              `Team ${teamId} already joined game ${gameId}, skipping JoinGame`
            )
            setPhase('wager')
          }
        })
        .catch((err) => {
          console.error('SignalR connection error:', err)
          setConnectionError('Failed to connect to hub: ' + err.message)
          setReconnecting(true)
          setTimeout(startConnection, 5000) // Retry after 5 seconds
        })
    }
    startConnection()

    // No cleanup in this effect; handled in separate useEffect
  }, [gameId, token, teamId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (
        hubConnection &&
        hubConnection.state !== signalR.HubConnectionState.Disconnected
      ) {
        hubConnection
          .stop()
          .then(() => console.log('Connection stopped on unmount'))
          .catch((err) => console.error('Error stopping connection:', err))
        setHubConnection(null)
      }
    }
  }, [hubConnection])

  // Timer effect
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

  // Start/Join a new game
  const joinGame = async () => {
    try {
      const response = await axios.post(
        'https://localhost:7169/api/game/start',
        { teamIds: [teamId] },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      console.log('Join Game Response:', response.data)
      const newGameId = response.data.gameId
      setGameId(newGameId)
      setRound(1)
      setQuestionNumber(1)
      setUsedWagers([])
      setSelectedWager(null)
      setPhase('idle')
      setAnswer('')
      setCorrectAnswer(null)
      setConnectionError(null)
      setReconnecting(false)
      delete joinedGamesRef.current[gameId] // Clear old game status
      if (
        hubConnection &&
        hubConnection.state !== signalR.HubConnectionState.Disconnected
      ) {
        hubConnection
          .stop()
          .then(() => console.log('Connection stopped before new game'))
          .catch((err) => console.error('Error stopping connection:', err))
        setHubConnection(null)
      }
    } catch (error) {
      alert(
        `Failed to join game: ${error.response?.data?.error || error.message}`
      )
    }
  }

  // Handle wager selection
  const handleWagerSelect = (wagerValue) => {
    setSelectedWager(wagerValue)
    setUsedWagers((prev) => [...prev, wagerValue])
    setPhase('waitingForQuestion')
    if (
      hubConnection &&
      hubConnection.state === signalR.HubConnectionState.Connected
    ) {
      hubConnection
        .invoke('SubmitWager', gameId, teamId, wagerValue, questionNumber)
        .catch((err) => console.error('Error sending wager:', err))
    }
  }

  // Submit answer
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
    let resetWagers = false

    if (questionNumber >= 3) {
      nextRound = round + 1
      nextQuestionNum = 1
      resetWagers = true
    }

    setRound(nextRound)
    setQuestionNumber(nextQuestionNum)
    if (resetWagers) setUsedWagers([])
    setSelectedWager(null)
    setAnswer('')
    setCorrectAnswer(null)
    setPhase('wager')

    if (
      hubConnection &&
      hubConnection.state === signalR.HubConnectionState.Connected
    ) {
      hubConnection
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
  } else if (connectionError) {
    content = <p>Error: {connectionError}</p>
  } else {
    if (phase === 'wager') {
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
                disabled={usedWagers.includes(value)}
              >
                {value} {value === 1 ? 'point' : 'points'}
              </button>
            ))}
          </div>
        </div>
      )
    } else if (phase === 'waitingForQuestion') {
      content = (
        <div className='waiting-screen'>
          <h3>
            Round {round} – Question {questionNumber}
          </h3>
          <p>Wager placed: {selectedWager} points.</p>
          <p>Waiting for other teams to wager...</p>
        </div>
      )
    } else if (phase === 'question') {
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
    } else if (phase === 'waitingForResults') {
      content = (
        <div className='waiting-screen'>
          <h3>
            Round {round} – Question {questionNumber}
          </h3>
          <p>Your answer has been submitted!</p>
          <p>Waiting for other teams to submit answers...</p>
        </div>
      )
    } else if (phase === 'reveal') {
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
