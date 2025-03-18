import { useState } from 'react'
import PropTypes from 'prop-types'

const LightningQuestion = ({
  question,
  onSubmit,
  timeLeft,
  reconnecting,
  onLogout,
}) => {
  const [selectedAnswer, setSelectedAnswer] = useState('')

  if (!question) {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>Lightning Bonus</h3>
        <p>Loading question data...</p>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  return (
    <div className='game-container'>
      {reconnecting && <p>Reconnecting…</p>}
      <h3>Lightning Bonus Question!</h3>
      <p className='bonus-explanation'>
        First team with correct answer gets +5 points
        <br />
        Second team gets +3 points
        <br />
        All other correct answers get +1 point
        <br />
        No negative points for wrong answers
      </p>
      <p>
        <strong>{question.text}</strong>
      </p>
      <div>
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
      <button
        onClick={() => onSubmit(selectedAnswer)}
        disabled={!selectedAnswer}
        style={{
          backgroundColor: '#4CAF50',
          color: 'white',
          fontWeight: 'bold',
          fontSize: '1.1em',
          padding: '12px 24px',
        }}
      >
        Submit Lightning Answer
      </button>
      <p>Time remaining: {timeLeft} seconds</p>
      <button className='logout_button' onClick={onLogout}>
        Logout
      </button>
    </div>
  )
}

LightningQuestion.propTypes = {
  question: PropTypes.shape({
    text: PropTypes.string.isRequired,
    options: PropTypes.arrayOf(PropTypes.string).isRequired,
  }).isRequired,
  onSubmit: PropTypes.func.isRequired,
  timeLeft: PropTypes.number.isRequired,
  reconnecting: PropTypes.bool.isRequired,
  onLogout: PropTypes.func.isRequired,
}

export default LightningQuestion
