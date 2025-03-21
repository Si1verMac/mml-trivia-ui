import { useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'

const Register = ({ onRegisterSuccess }) => {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [isOperator, setIsOperator] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const response = await axios.post(
        'https://localhost:7169/api/auth/register',
        { name, password, isOperator }
      )
      alert(`Team registered successfully! Team ID: ${response.data.teamId}`)
      onRegisterSuccess()
    } catch (error) {
      alert(
        `Registration failed: ${error.response?.data?.error || error.message}`
      )
    }
  }

  return (
    <div className='register-container'>
      <h2>Team Registration</h2>
      <form onSubmit={handleSubmit}>
        <input
          type='text'
          placeholder='Team Name'
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type='password'
          placeholder='Password'
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label>
          <input
            type='checkbox'
            checked={isOperator}
            onChange={(e) => setIsOperator(e.target.checked)}
          />
          Register as Operator
        </label>
        <button type='submit'>Register Team</button>
      </form>
    </div>
  )
}

Register.propTypes = {
  onRegisterSuccess: PropTypes.func.isRequired,
}

export default Register
