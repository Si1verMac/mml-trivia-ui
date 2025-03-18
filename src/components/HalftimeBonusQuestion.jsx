import { useState } from 'react'
import PropTypes from 'prop-types'

const HalftimeBonusQuestion = ({
  question,
  onSubmit,
  timeLeft,
  reconnecting,
  onLogout,
}) => {
  const [answers, setAnswers] = useState(Array(8).fill(''))

  const handleChange = (index, value) => {
    const newAnswers = [...answers]
    newAnswers[index] = value
    console.log('handle change' + newAnswers)
    setAnswers(newAnswers)
  }

  const handleSubmit = () => {
    // Filter out empty answers and submit only non-empty ones
    const nonEmptyAnswers = answers
      .map((answer) => answer.trim())
      .filter((answer) => answer.length > 0)

    // Log the actual answers being submitted
    console.log('Submitting halftime answers:', nonEmptyAnswers)

    // Submit as a simple array of strings, which will be sent as JSON to the server
    onSubmit(nonEmptyAnswers)
  }

  if (!question) {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>Halftime Bonus</h3>
        <p>Loading question data...</p>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  // Calculate if submit button should be enabled (at least one answer)
  const hasAtLeastOneAnswer = answers.some((answer) => answer.trim().length > 0)

  return (
    <div className='game-container'>
      {reconnecting && <p>Reconnecting…</p>}
      <h3>Halftime Bonus Round</h3>
      <p className='bonus-explanation'>
        Fill in up to 8 answers. Each correct answer is worth 1 point.
        <br />
        +1 bonus point for getting all 8 correct!
      </p>
      <p>
        <strong>{question.text}</strong>
      </p>
      <div className='halftime-answers'>
        {answers.map((answer, index) => (
          <div key={index} className='halftime-answer-input'>
            <label>{index + 1}.</label>
            <input
              type='text'
              value={answer}
              placeholder='Your answer here...'
              onChange={(e) => handleChange(index, e.target.value)}
              style={{
                width: '80%',
                padding: '8px',
                marginBottom: '10px',
                borderRadius: '4px',
                border: '1px solid #ccc',
              }}
            />
          </div>
        ))}
      </div>
      <button
        onClick={handleSubmit}
        disabled={!hasAtLeastOneAnswer}
        style={{
          backgroundColor: '#4CAF50',
          color: 'white',
          fontWeight: 'bold',
          padding: '10px 20px',
          fontSize: '1.1em',
          marginTop: '15px',
          border: 'none',
          borderRadius: '4px',
          cursor: !hasAtLeastOneAnswer ? 'not-allowed' : 'pointer',
        }}
      >
        Submit Answers
      </button>
      <p>Time remaining: {timeLeft} seconds</p>
      <button className='logout_button' onClick={onLogout}>
        Logout
      </button>
    </div>
  )
}

HalftimeBonusQuestion.propTypes = {
  question: PropTypes.shape({
    text: PropTypes.string.isRequired,
  }).isRequired,
  onSubmit: PropTypes.func.isRequired,
  timeLeft: PropTypes.number.isRequired,
  reconnecting: PropTypes.bool.isRequired,
  onLogout: PropTypes.func.isRequired,
}

export default HalftimeBonusQuestion
