import { useState } from 'react'
import PropTypes from 'prop-types'

const FinalWagerQuestion = ({
  question,
  onSubmit,
  timeLeft,
  reconnecting,
  onLogout,
}) => {
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const [wager, setWager] = useState(15)

  if (!question) {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>Final Question</h3>
        <p>Loading question data...</p>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  const handleSubmit = () => {
    if (!selectedAnswer) {
      alert('Please select an answer')
      return
    }
    onSubmit(selectedAnswer, wager)
  }

  return (
    <div className='game-container'>
      {reconnecting && <p>Reconnecting…</p>}
      <h3>Final Wager Question</h3>
      <p className='bonus-explanation'>
        This is the final question! You can wager up to 15 points.
      </p>
      <p>
        <strong>
          {question.text.replace(/^"25\.\s*|^25\.\s*|^"/, '').replace(/"$/, '')}
        </strong>
      </p>
      <div>
        <p>Select your wager (up to 15 points):</p>
        <input
          type='number'
          min='1'
          max='15'
          value={wager}
          onChange={(e) =>
            setWager(Math.min(15, Math.max(1, parseInt(e.target.value) || 1)))
          }
        />
      </div>
      <p>Selected wager: {wager}</p>
      <div>
        <p>Your answer:</p>
        <input
          type='text'
          value={selectedAnswer}
          onChange={(e) => setSelectedAnswer(e.target.value)}
        />
      </div>
      <button onClick={handleSubmit} disabled={!selectedAnswer}>
        Submit Final Answer
      </button>
      <p>Time remaining: {timeLeft} seconds</p>
      <button className='logout_button' onClick={onLogout}>
        Logout
      </button>
    </div>
  )
}

FinalWagerQuestion.propTypes = {
  question: PropTypes.shape({
    text: PropTypes.string.isRequired,
  }).isRequired,
  onSubmit: PropTypes.func.isRequired,
  timeLeft: PropTypes.number.isRequired,
  reconnecting: PropTypes.bool.isRequired,
  onLogout: PropTypes.func.isRequired,
}

export default FinalWagerQuestion
