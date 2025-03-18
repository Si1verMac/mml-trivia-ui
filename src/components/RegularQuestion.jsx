import { useState } from 'react'
import PropTypes from 'prop-types'

const RegularQuestion = ({
  question,
  onSubmit,
  timeLeft,
  reconnecting,
  onLogout,
}) => {
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const [wager, setWager] = useState(null)

  if (!question) {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>Regular Question</h3>
        <p>Loading question data...</p>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  const handleSubmit = () => {
    if (!wager) {
      alert('Please select a wager')
      return
    }
    if (!selectedAnswer) {
      alert('Please select an answer')
      return
    }
    onSubmit(selectedAnswer, wager)
  }

  return (
    <div className='game-container'>
      {reconnecting && <p>Reconnecting…</p>}
      <h3>
        Round {question.round}: Question {question.questionNumber}
      </h3>
      <p>
        <strong>{question.text}</strong>
      </p>
      <div>
        <p>Select your wager:</p>
        {[1, 3, 5].map((w) => (
          <button
            key={w}
            onClick={() => setWager(w)}
            style={{ fontWeight: wager === w ? 'bold' : 'normal' }}
          >
            {w} pts
          </button>
        ))}
      </div>
      <p>Selected wager: {wager || 0}</p>
      <div>
        <p>Choose your answer:</p>
        {question.options.map((opt) => (
          <label key={opt} style={{ display: 'block' }}>
            <input
              type='radio'
              name='answerChoice'
              value={opt}
              checked={selectedAnswer === opt}
              onChange={() => setSelectedAnswer(opt)}
            />
            {opt}
          </label>
        ))}
      </div>
      <button onClick={handleSubmit} disabled={!selectedAnswer || !wager}>
        Submit Answer
      </button>
      <p>Time remaining: {timeLeft} seconds</p>
      <button className='logout_button' onClick={onLogout}>
        Logout
      </button>
    </div>
  )
}

RegularQuestion.propTypes = {
  question: PropTypes.shape({
    round: PropTypes.number.isRequired,
    questionNumber: PropTypes.number.isRequired,
    text: PropTypes.string.isRequired,
    options: PropTypes.arrayOf(PropTypes.string).isRequired,
  }).isRequired,
  onSubmit: PropTypes.func.isRequired,
  timeLeft: PropTypes.number.isRequired,
  reconnecting: PropTypes.bool.isRequired,
  onLogout: PropTypes.func.isRequired,
}

export default RegularQuestion
