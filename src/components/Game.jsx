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
  const [isNextClicked, setIsNextClicked] = useState(false)

  const hubConnectionRef = useRef(null)
  const joinedGamesRef = useRef({})

  useEffect(() => {
    if (!gameId) return

    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state === signalR.HubConnectionState.Connected &&
      joinedGamesRef.current[gameId]
    ) {
      console.log(
        `Team ${teamId} already joined game ${gameId}, skipping setup`
      )
      return
    }

    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state !== signalR.HubConnectionState.Disconnected
    ) {
      hubConnectionRef.current
        .stop()
        .catch((err) => console.error('Error stopping connection:', err))
      hubConnectionRef.current = null
    }

    const connection = new signalR.HubConnectionBuilder()
      .withUrl('https://localhost:7169/triviahub', {
        accessTokenFactory: () => token,
        transport: signalR.HttpTransportType.LongPolling,
      })
      .configureLogging(signalR.LogLevel.Information)
      .withAutomaticReconnect()
      .build()

    connection.on('TeamJoined', (data) => {
      console.log('TeamJoined:', data)
      joinedGamesRef.current[gameId] = true
      setPhase('idle')
      setConnectionError(null)
      setReconnecting(false)
    })

    connection.on('Question', (questionData) => {
      console.log('Question received:', questionData)
      setQuestionText(questionData.text || '')
      setAnswerOptions(questionData.options || [])
      setAnswer('')
      setCorrectAnswer(null)
      setTimeLeft(150)
      setPhase('question')
      setCurrentQuestionId(questionData.id || null)
      setWagerSubmitted(false)
      setSelectedWager(null)
      setIsNextClicked(false)
    })

    connection.on('AnswerSubmitted', (data) => {
      console.log('AnswerSubmitted:', data)
      if (data.teamId === teamId) {
        // Only change phase for the submitting team
        setPhase('waitingForResults')
        setTimeLeft(0)
      }
    })

    connection.on('DisplayAnswer', (questionId, correctAns) => {
      console.log('DisplayAnswer:', { questionId, correctAns })
      setCorrectAnswer(
        `The correct answer for question ${questionId} is: ${correctAns}`
      )
      setPhase('reveal')
      setTimeLeft(0)
    })

    connection.on('GameEnded', () => {
      console.log('GameEnded received')
      setPhase('idle')
      setGameId(null)
    })

    connection.on('AdvanceToNextQuestion', () => {
      console.log('AdvanceToNextQuestion received')
      goToNextQuestion()
    })

    connection.on('Error', (message) => {
      console.error('Error from hub:', message)
      setConnectionError(message)
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
      }
    })

    const handleJoinError = (err) => {
      console.error('Failed to invoke JoinGame:', err)
      if (err.message && err.message.includes('has already joined')) {
        console.log(`Team ${teamId} already in game ${gameId}, proceeding`)
        joinedGamesRef.current[gameId] = true
        setPhase('idle')
        setConnectionError(null)
        setReconnecting(false)
      } else {
        setConnectionError('Failed to join game: ' + err.message)
        setReconnecting(true)
      }
    }

    const startConnection = () => {
      console.log('Starting SignalR connection...')
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
          setConnectionError('Failed to connect: ' + err.message)
          setReconnecting(true)
          setTimeout(startConnection, 5000)
        })
    }
    startConnection()

    return () => {
      if (
        hubConnectionRef.current &&
        hubConnectionRef.current.state !==
          signalR.HubConnectionState.Disconnected
      ) {
        hubConnectionRef.current
          .stop()
          .catch((err) => console.error('Error stopping connection:', err))
        hubConnectionRef.current = null
      }
    }
  }, [gameId, token, teamId])

  useEffect(() => {
    let timerId
    if (phase === 'question' && timeLeft > 0) {
      timerId = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerId)
            if (phase === 'question') {
              setPhase('waitingForResults')
            }
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(timerId)
  }, [phase, timeLeft])

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
      setRound(1)
      setQuestionNumber(1)
      setSelectedWager(null)
      setWagerSubmitted(false)
      setPhase('idle')
      setAnswer('')
      setCorrectAnswer(null)
      setConnectionError(null)
      setReconnecting(false)
      delete joinedGamesRef.current[newGameId]
    } catch (error) {
      alert(
        `Failed to join game: ${error.response?.data?.error || error.message}`
      )
    }
  }

  const startGame = async () => {
    try {
      await axios.post(
        'https://localhost:7169/api/game/start',
        { gameId },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      console.log('Game started')
    } catch (error) {
      alert(
        `Failed to start game: ${error.response?.data?.error || error.message}`
      )
    }
  }

  const handleWagerSelect = (wagerValue) => {
    if (wagerSubmitted) return
    if (!currentQuestionId) {
      console.error('No current question ID available.')
      return
    }
    setSelectedWager(wagerValue)
    setWagerSubmitted(true)
    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state === signalR.HubConnectionState.Connected
    ) {
      hubConnectionRef.current
        .invoke('SubmitWager', gameId, teamId, wagerValue, currentQuestionId)
        .catch((err) => console.error('Error sending wager:', err))
    }
  }

  const submitAnswer = async () => {
    if (!answer || !selectedWager) {
      alert('Please select both an answer and a wager.')
      return
    }
    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state === signalR.HubConnectionState.Connected
    ) {
      try {
        await hubConnectionRef.current.invoke(
          'SubmitAnswer',
          gameId,
          teamId,
          currentQuestionId,
          answer,
          selectedWager
        )
        console.log(
          'Answer submitted via hub:',
          answer,
          '(wager:',
          selectedWager,
          ')'
        )
      } catch (error) {
        alert(`Failed to submit answer: ${error.message}`)
      }
    } else {
      alert('SignalR connection is not established.')
    }
  }

  const signalReadyForNext = () => {
    if (
      hubConnectionRef.current &&
      hubConnectionRef.current.state === signalR.HubConnectionState.Connected &&
      !isNextClicked
    ) {
      console.log(`Team ${teamId} signaling ready for game ${gameId}`)
      hubConnectionRef.current
        .invoke('SignalReadyForNext', gameId, teamId)
        .catch((err) => console.error('Error signaling ready for next:', err))
      setIsNextClicked(true)
    }
  }

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
    setWagerSubmitted(false)
    setIsNextClicked(false)
    setPhase('question')
  }

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
      case 'question':
        content = (
          <div className='question-phase'>
            <h3>
              Round {round} – Question {questionNumber}
            </h3>
            <p>
              <strong>{questionText}</strong>
            </p>
            <div className='wager-options'>
              <p>Select your wager:</p>
              {[1, 3, 5].map((wager, idx) => (
                <button
                  key={idx}
                  onClick={() => handleWagerSelect(wager)}
                  disabled={wagerSubmitted}
                >
                  {wager} {wager === 1 ? 'point' : 'points'}
                </button>
              ))}
            </div>
            <div className='answer-options'>
              <p>Select your answer:</p>
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
            <button onClick={submitAnswer} disabled={!answer || !selectedWager}>
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
            <p>Your answer has been submitted! Waiting for results...</p>
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
            <button onClick={signalReadyForNext} disabled={isNextClicked}>
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
