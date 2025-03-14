import trivia_logo from '/mcm_trivia_logo.png'

const Header = () => {
  return (
    <header className='app-header'>
      <img src={trivia_logo} className='headerImg' />
      <h1>McMillan Trivia!</h1>
      <div className='header-divider'></div>
    </header>
  )
}

export default Header
