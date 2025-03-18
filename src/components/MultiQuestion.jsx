import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'

const MultiQuestion = ({
  question,
  onSubmit,
  timeLeft,
  reconnecting,
  onLogout,
}) => {
  const [answers, setAnswers] = useState({})

  useEffect(() => {
    if (question && question.parsedQuestionsData) {
      const initialAnswers = {}
      Object.keys(question.parsedQuestionsData).forEach((qid) => {
        initialAnswers[qid] = ''
      })
      setAnswers(initialAnswers)
    }
  }, [question])

  const handleAnswerChange = (questionId, value) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: value,
    }))
  }

  const handleSubmit = () => {
    if (Object.values(answers).some((a) => a.trim())) {
      const cleanedAnswers = {}
      Object.keys(answers).forEach((key) => {
        if (answers[key].trim()) {
          cleanedAnswers[key] = answers[key].trim()
        }
      })

      onSubmit(JSON.stringify(cleanedAnswers))
    } else {
      alert('Please enter at least one answer!')
    }
  }

  if (!question || !question.parsedQuestionsData) {
    return (
      <div className='game-container'>
        <h3>Round 5: Fill-in-the-Blank</h3>
        <p>Loading question data...</p>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  const questionsData = question.parsedQuestionsData
  const hasAtLeastOneAnswer = Object.values(answers).some((a) => a.trim())

  return (
    <div className='game-container'>
      {reconnecting && <p>Reconnecting…</p>}
      <h3>Round 5: Fill-in-the-Blank</h3>
      <p className='bonus-explanation'>
        Answer all 8 questions. Each correct answer is worth 1 point.
      </p>
      <div className='multi-questions'>
        {Object.keys(questionsData).map((qid) => (
          <div key={qid} className='multi-question-item'>
            <p>
              <strong>{questionsData[qid].text}</strong>
            </p>
            <input
              type='text'
              value={answers[qid] || ''}
              placeholder='Your answer here...'
              onChange={(e) => handleAnswerChange(qid, e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                marginBottom: '15px',
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
          backgroundColor: hasAtLeastOneAnswer ? '#4CAF50' : '#cccccc',
          color: 'white',
          fontWeight: 'bold',
          padding: '10px 20px',
          fontSize: '1.1em',
          marginTop: '15px',
          border: 'none',
          borderRadius: '4px',
          cursor: hasAtLeastOneAnswer ? 'pointer' : 'not-allowed',
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

MultiQuestion.propTypes = {
  question: PropTypes.shape({
    parsedQuestionsData: PropTypes.object,
  }),
  onSubmit: PropTypes.func.isRequired,
  timeLeft: PropTypes.number.isRequired,
  reconnecting: PropTypes.bool.isRequired,
  onLogout: PropTypes.func.isRequired,
}

export default MultiQuestion
