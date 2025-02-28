import { useState, useEffect } from 'react'
import axios from 'axios'
import * as signalR from '@microsoft/signalr'
import PropTypes from 'prop-types'
import { jwtDecode } from 'jwt-decode'

const Game = ({ token, setGameId, gameId, onLogout }) => {
  // Decode token to get team ID (for API and SignalR calls)
  const decodedToken = jwtDecode(token)
  const teamId = parseInt(decodedToken.teamId)

  // State for game flow
  const [phase, setPhase] = useState('idle') // can be 'wager', 'waitingForQuestion', 'question', 'waitingForResults', 'reveal'
  const [round, setRound] = useState(1)
  const [questionNumber, setQuestionNumber] = useState(1) // 1-3 within a round
  const [usedWagers, setUsedWagers] = useState([]) // wagers used in the current round
  const [selectedWager, setSelectedWager] = useState(null) // wager chosen for current question

  // State for question/answer data
  const [questionText, setQuestionText] = useState('')
  const [answerOptions, setAnswerOptions] = useState([]) // multiple-choice options for current question
  const [answer, setAnswer] = useState('') // team's selected answer (option text or id)
  const [correctAnswer, setCorrectAnswer] = useState(null) // correct answer text (revealed after everyone answers)
  const [currentQuestionId, setCurrentQuestionId] = useState(null)

  // Timer state for the question phase
  const [timeLeft, setTimeLeft] = useState(0)

  // SignalR connection reference (to call hub methods outside useEffect)
  const [hubConnection, setHubConnection] = useState(null)

  // Establish SignalR connection and event handlers when game starts
  useEffect(() => {
    if (gameId) {
      // Build and start the connection
      const connection = new signalR.HubConnectionBuilder()
        .withUrl('https://localhost:7169/triviaHub', {
          accessTokenFactory: () => token,
        })
        .configureLogging(signalR.LogLevel.Information)
        .build()

      // Define SignalR event handlers:
      // 1. Receive a new question (after all teams have wagered)
      connection.on('Question', (questionData) => {
        // questionData could be an object { id, text, options }
        setQuestionText(questionData.text)
        setAnswerOptions(questionData.options)
        setAnswer('') // reset any previous answer selection
        setCorrectAnswer(null)
        setTimeLeft(150) // 2.5 minutes in seconds for the timer
        setPhase('question') // move to question display phase
        // Store current question ID for submitting answer
        setCurrentQuestionId(questionData.id)
      })

      // 2. Receive the correct answer to display (after all answers submitted or time up)
      connection.on('DisplayAnswer', (questionId, correctAns) => {
        // Show the correct answer for the question
        setCorrectAnswer(
          `The correct answer for question ${questionId} is: ${correctAns}`
        )
        setPhase('reveal') // move to answer reveal phase
        setTimeLeft(0) // stop any timer
      })

      // (Optional) 3. If the server signals that all teams have wagered (could also directly send Question event)
      connection.on('AllWagersIn', () => {
        // This event could be used if server indicates it's time to show the question.
        // In this implementation, we assume the 'Question' event carries the question data.
        // If using AllWagersIn as a separate signal, we might trigger a fetch or wait for a 'Question' event next.
      })

      // Start the connection, then join the game group
      connection
        .start()
        .then(() => {
          connection
            .invoke('JoinGame', gameId.toString())
            .catch((err) => console.error('Failed to join game group:', err))
        })
        .catch((err) => console.error('SignalR connection error:', err))

      setHubConnection(connection) // save connection to state for later use

      return () => {
        // Cleanup: stop SignalR connection when component unmounts or gameId changes
        connection.stop()
      }
    }
  }, [gameId, token])

  // Effect to handle the countdown timer during the question phase
  useEffect(() => {
    let timerId
    if (phase === 'question' && timeLeft > 0) {
      timerId = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            // Time's up: stop timer and move to waiting phase if not answered yet
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
    // Cleanup interval on phase change or unmount
    return () => clearInterval(timerId)
  }, [phase, timeLeft])

  // Function: Start/Join a new game (called when clicking "Join Game")
  const joinGame = async () => {
    try {
      const response = await axios.post(
        'https://localhost:7169/api/game/start',
        { teamIds: [teamId] }, // start a game with this team (and possibly others if included)
        { headers: { Authorization: `Bearer ${token}` } }
      )
      console.log('Join Game Response:', response.data)
      // Initialize game state for new game
      setGameId(response.data.gameId)
      setRound(1)
      setQuestionNumber(1)
      setUsedWagers([])
      setSelectedWager(null)
      setPhase('wager') // immediately go to wager selection for question 1
      setAnswer('')
      setCorrectAnswer(null)
    } catch (error) {
      alert(
        `Failed to join game: ${error.response?.data?.error || error.message}`
      )
    }
  }

  // Function: Handle wager selection by the team
  const handleWagerSelect = (wagerValue) => {
    setSelectedWager(wagerValue)
    setUsedWagers((prev) => [...prev, wagerValue])
    setPhase('waitingForQuestion') // waiting for question to be revealed (other teams to wager)
    // Inform server of this team's wager selection (so it can track readiness)
    if (hubConnection) {
      hubConnection
        .invoke('SubmitWager', gameId, teamId, wagerValue, questionNumber)
        .catch((err) => console.error('Error sending wager to server:', err))
    }
  }

  // Function: Submit the selected answer for the current question
  const submitAnswer = async () => {
    if (!answer) {
      alert('Please select an answer before submitting.')
      return
    }
    try {
      // Send answer to server via API
      await axios.post(
        'https://localhost:7169/api/game/submit-answer',
        {
          gameId: gameId,
          teamId: teamId,
          questionId: currentQuestionId, // use the current question's ID
          selectedAnswer: answer,
          wager: selectedWager, // use the wager chosen for this question
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      // After submitting, go to waiting-for-results phase
      setPhase('waitingForResults')
      setTimeLeft(0) // stop the timer
      console.log('Answer submitted:', answer, '(wager:', selectedWager, ')')
    } catch (error) {
      alert(
        `Failed to submit answer: ${
          error.response?.data?.error || error.message
        }`
      )
    }
  }

  // Function: Proceed to the next question (or next round if current round ended)
  const goToNextQuestion = () => {
    // Prepare for next question
    let nextQuestionNum = questionNumber + 1
    let nextRound = round
    let resetWagers = false

    if (questionNumber >= 3) {
      // Current round finished, start a new round
      nextRound = round + 1
      nextQuestionNum = 1
      resetWagers = true
    }

    // Update state for new question/round
    setRound(nextRound)
    setQuestionNumber(nextQuestionNum)
    if (resetWagers) {
      setUsedWagers([]) // reset wagers for the new round
    }
    setSelectedWager(null)
    setAnswer('')
    setCorrectAnswer(null)

    // Move to wager selection phase for the next question
    setPhase('wager')

    // (Optional) Notify server that this team is ready for the next question/round
    if (hubConnection) {
      hubConnection
        .invoke(
          'ReadyForNextQuestion',
          gameId,
          teamId,
          nextRound,
          nextQuestionNum
        )
        .catch((err) =>
          console.error('Error notifying ready for next question:', err)
        )
    }
  }

  // Render different UI based on the current phase of the game
  let content
  if (!gameId) {
    // Not in a game yet: show Join button
    content = <button onClick={joinGame}>Join Game</button>
  } else {
    // In a game: show appropriate interface based on phase
    if (phase === 'wager') {
      // Wager selection phase
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
      // Waiting for question to be revealed (other teams still wagering)
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
      // Question display and answering phase
      content = (
        <div className='question-phase'>
          <h3>
            Round {round} – Question {questionNumber}
          </h3>
          <p>
            <strong>{questionText}</strong>
          </p>
          <div className='options-list'>
            {/* Multiple-choice options */}
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
          {/* Display timer */}
          <div className='timer'>Time remaining: {timeLeft} seconds</div>
        </div>
      )
    } else if (phase === 'waitingForResults') {
      // Answer submitted; waiting for others to finish
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
      // Correct answer revealed
      content = (
        <div className='reveal-phase'>
          <h3>
            Round {round} – Question {questionNumber} Results
          </h3>
          {correctAnswer && <p>{correctAnswer}</p>}
          {/* (Optional: We could show the team's answer and whether it was correct, and their wager) */}
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
