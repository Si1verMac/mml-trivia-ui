import { useState } from 'react'
import axios from 'axios'
import PropTypes from 'prop-types'

const Login = ({ onLogin }) => {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const response = await axios.post(
        'https://localhost:7169/api/auth/login',
        { name, password }
      )
      const { token } = response.data
      onLogin(token)
    } catch (error) {
      alert(
        `Team login failed: ${error.response?.data?.error || error.message}`
      )
    }
  }

  return (
    <div className='login-container'>
      <h2>Team Login</h2>
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
        <button type='submit'>Login</button>
      </form>
    </div>
  )
}

Login.propTypes = {
  onLogin: PropTypes.func.isRequired,
}

export default Login
