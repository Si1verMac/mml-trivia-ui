import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import axios from 'axios'
import { jwtDecode } from 'jwt-decode'
import * as signalR from '@microsoft/signalr'
import PropTypes, { array } from 'prop-types'
import Confetti from 'react-confetti'

// Import new question components (assumed to be in separate files)
import RegularQuestion from './RegularQuestion'
import HalftimeBonusQuestion from './HalftimeBonusQuestion'
import MultiQuestion from './MultiQuestion'
import LightningQuestion from './LightningQuestion'
import FinalWagerQuestion from './FinalWagerQuestion'

const Game = ({
  token,
  gameId,
  setGameId,
  onLogout,
  connection,
  isReconnecting,
  gameState,
  updateGameState,
}) => {
  const decoded = jwtDecode(token)
  const teamId = parseInt(decoded.teamId, 10)

  // UI state
  const [phase, setPhase] = useState(gameState.currentPhase || 'idle')
  const [round, setRound] = useState(gameState.question?.round || 1)
  const [questionNumber, setQuestionNumber] = useState(
    gameState.question?.questionNumber || 1
  )
  const [questionText, setQuestionText] = useState(
    gameState.question?.text || ''
  )
  // answerOptions is used by child components and for rendering questions
  // eslint-disable-next-line no-unused-vars
  const [answerOptions, setAnswerOptions] = useState(
    gameState.question?.options || []
  )
  const [connectionError, setConnectionError] = useState(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [joinedTeams, setJoinedTeams] = useState([])
  const [activeGames, setActiveGames] = useState([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [hasSignaledReady, setHasSignaledReady] = useState(false)
  const [hasReceivedAnswer, setHasReceivedAnswer] = useState(false)
  const [answeredQuestions, setAnsweredQuestions] = useState(new Set())
  const [showOverlay, setShowOverlay] = useState(false)
  const [overlayMessage, setOverlayMessage] = useState('')
  const [isCorrect, setIsCorrect] = useState(false)
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [teamAnswerCorrect, setTeamAnswerCorrect] = useState(null)
  const [selectedWager, setSelectedWager] = useState(null)
  // answer and timeLeft are used by child components
  // eslint-disable-next-line no-unused-vars
  const [answer, setAnswer] = useState('')
  // eslint-disable-next-line no-unused-vars
  const [timeLeft, setTimeLeft] = useState(gameState.timeLeft || 0)

  const timeoutRef = useRef(null)
  const eventsRegistered = useRef(false)
  const timerRef = useRef(null)
  const initializedRef = useRef(false)

  // Sync initial timeLeft from gameState on first render
  useEffect(() => {
    if (!initializedRef.current && gameState.timeLeft > 0) {
      console.log(
        `One-time timer initialization from gameState: ${gameState.timeLeft} seconds`
      )
      setTimeLeft(gameState.timeLeft)
      initializedRef.current = true
    }
  }, [gameState.timeLeft])

  // Sync App gameState with local UI state (for gameState-driven updates)
  useEffect(() => {
    if (!gameState) {
      console.error('gameState is undefined in sync effect')
      return
    }

    if (gameState.currentPhase !== phase) {
      console.log(
        `Updating local phase to ${gameState.currentPhase} from ${phase}`
      )
      setPhase(gameState.currentPhase)
    }
    if (gameState.question && gameState.question.text !== questionText) {
      console.log('Updating local question from App gameState')
      if (gameState.question.round) setRound(gameState.question.round)
      if (gameState.question.questionNumber)
        setQuestionNumber(gameState.question.questionNumber)
      if (gameState.question.text) setQuestionText(gameState.question.text)
    }
    if (gameState.correctAnswer && gameState.correctAnswer !== '') {
      console.log(gameState.correctAnswer + ' Line 73')
      setHasReceivedAnswer(true)
    }
  }, [gameState, phase, questionText])

  // Set up SignalR events
  useEffect(() => {
    if (!connection || !gameId || eventsRegistered.current) return

    console.log('Registering Game component event handlers')

    connection.on('GameStarted', (data) => {
      console.log('GameStarted event received:', data)
      changePhase('question')
    })

    connection.on('TeamJoined', ({ teamId: joinedId }) => {
      console.log(`Team ${joinedId} joined the game`)
      setJoinedTeams((prev) =>
        prev.includes(joinedId) ? prev : [...prev, joinedId]
      )
    })

    connection.on('GameState', (state) => {
      console.log('GameState received:', state)
      if (
        state.status === 'InProgress' &&
        (phase === 'idle' || phase === 'waiting')
      ) {
        changePhase('question')
      } else if (
        state.status === 'Created' &&
        phase !== 'question' &&
        phase !== 'reveal' &&
        phase !== 'waitingForAnswers'
      ) {
        changePhase('waiting')
      } else if (state.status === 'Ended') {
        changePhase('ended')
      }
    })

    connection.on('GameEnded', () => {
      console.log('GameEnded event')
      changePhase('ended')
      setTimeLeft(0)
    })

    connection.on(
      'DisplayAnswer',
      (
        questionId,
        correctAnswer,
        isCorrectFromServer,
        wager,
        scoreChangeFromServer
      ) => {
        console.log(
          'DisplayAnswer event received:',
          questionId,
          correctAnswer,
          isCorrectFromServer,
          wager,
          scoreChangeFromServer
        )
        const questionType = gameState.questionType || 'regular'
        const questionTextLower =
          typeof gameState.question?.text === 'string'
            ? gameState.question.text.toLowerCase()
            : Array.isArray(gameState.question?.text) &&
              gameState.question.text.length > 0
            ? gameState.question.text[0].toLowerCase()
            : ''
        let parsedAnswer = correctAnswer || ''

        // Preserve current question information for display during reveal
        const currentRound = gameState.question?.round || round
        const currentQuestionNumber =
          gameState.question?.questionNumber || questionNumber
        const currentQuestionText = gameState.question?.text || questionText

        // More precise check for halftime bonus and multi-question
        const isHalftimeBonusType =
          questionType === 'halftimeBonus' ||
          (questionType !== 'lightning' &&
            questionType !== 'finalWager' &&
            questionTextLower.includes('halftime bonus'))

        const isMultiQuestionType =
          questionType === 'multiQuestion' ||
          (questionType !== 'lightning' &&
            questionType !== 'finalWager' &&
            questionType !== 'halftimeBonus' &&
            (questionTextLower.includes('fill in the blank') ||
              currentRound === 5))

        console.log('Question type diagnosis:', {
          type: questionType,
          isHalftimeBonusType,
          isMultiQuestionType,
          scoreChangeFromServer,
        })

        // Store the scoreChangeFromServer as a local variable
        let pointsEarned = 0

        // For halftime bonus and multi-question, we need to show the correct points
        if (isHalftimeBonusType || isMultiQuestionType) {
          if (scoreChangeFromServer !== undefined) {
            // If server sent a score, use it
            pointsEarned = scoreChangeFromServer
            console.log(`Using server-provided score: ${pointsEarned}`)

            // Only update necessary fields to avoid infinite loops
            updateGameState((prevState) => ({
              ...prevState,
              scoreChange: scoreChangeFromServer,
            }))
          } else if (gameState.scoreChange !== undefined) {
            // Fallback to the stored score if available
            pointsEarned = gameState.scoreChange
            console.log(`No server score, using stored score: ${pointsEarned}`)
          }

          console.log(`Final points value for overlay: ${pointsEarned}`)
        }

        // Clean any answer format regardless of question type
        if (typeof parsedAnswer === 'string') {
          // Remove curly braces if present
          if (parsedAnswer.startsWith('{') && parsedAnswer.endsWith('}')) {
            parsedAnswer = parsedAnswer.substring(1, parsedAnswer.length - 1)
          }
          // Remove quotes if present
          if (parsedAnswer.startsWith('"') && parsedAnswer.endsWith('"')) {
            parsedAnswer = parsedAnswer.substring(1, parsedAnswer.length - 1)
          }
        }

        // Check for lightning question for proper display during reveal
        const isLightningQuestion =
          questionType === 'lightning' ||
          currentQuestionNumber === 10 ||
          extractQuestionNumber(
            typeof currentQuestionText === 'string'
              ? currentQuestionText
              : Array.isArray(currentQuestionText) &&
                currentQuestionText.length > 0
              ? currentQuestionText[0]
              : ''
          ) === 10 ||
          questionTextLower.includes('lightning')

        // Check for halftime bonus
        const isHalftimeBonus =
          questionType === 'halftimeBonus' ||
          currentQuestionNumber === 11 ||
          extractQuestionNumber(
            typeof currentQuestionText === 'string'
              ? currentQuestionText
              : Array.isArray(currentQuestionText) &&
                currentQuestionText.length > 0
              ? currentQuestionText[0]
              : ''
          ) === 11 ||
          questionTextLower.includes('halftime bonus')

        // Check for Round 5 multi-question
        const isMultiQuestion =
          questionType === 'multiQuestion' ||
          currentRound === 5 ||
          (typeof currentQuestionText === 'string' &&
            currentQuestionText.startsWith('{')) ||
          Array.isArray(currentQuestionText)

        // Function to split comma-separated answers for Round 5
        // eslint-disable-next-line no-unused-vars
        const splitMultiQuestionAnswers = (answerString) => {
          if (!answerString || typeof answerString !== 'string')
            return answerString

          // If the string is in the format "{answer1,answer2,...}"
          if (answerString.startsWith('{') && answerString.endsWith('}')) {
            // Remove the curly braces
            const withoutBraces = answerString.substring(
              1,
              answerString.length - 1
            )
            // Split by commas
            return withoutBraces.split(',').map((a) => a.trim())
          }

          // If it's just a comma-separated string without braces
          if (answerString.includes(',')) {
            return answerString.split(',').map((a) => a.trim())
          }

          return answerString
        }

        // Handle the halftimeBonus answers specially
        if (isHalftimeBonus) {
          console.log(
            'Processing halftimeBonus correct answers:',
            correctAnswer
          )

          // Handle array answers directly from database
          if (Array.isArray(correctAnswer)) {
            // Clean each answer
            parsedAnswer = correctAnswer.map((answer) => {
              if (typeof answer === array) {
                let cleaned = answer.trim()
                // Remove curly braces
                if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                  cleaned = cleaned.substring(1, cleaned.length - 1).trim()
                }
                // Remove quotes
                if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                  cleaned = cleaned.substring(1, cleaned.length - 1).trim()
                }
                return cleaned
              }
              return answer
            })
          }
          // Handle string that might be JSON or comma-separated
          else if (typeof correctAnswer === 'string') {
            // First, try to parse as JSON
            try {
              // Clean the string first
              let cleanedAnswer = correctAnswer
              if (
                cleanedAnswer.startsWith('"') &&
                cleanedAnswer.endsWith('"')
              ) {
                cleanedAnswer = cleanedAnswer.substring(
                  1,
                  cleanedAnswer.length - 1
                )
              }

              if (
                cleanedAnswer.startsWith('[') &&
                cleanedAnswer.endsWith(']')
              ) {
                const parsed = JSON.parse(cleanedAnswer)
                if (Array.isArray(parsed)) {
                  parsedAnswer = parsed.map((item) => {
                    if (typeof item === 'string') {
                      let cleaned = item.trim()
                      // Clean quotes and braces
                      if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                        cleaned = cleaned
                          .substring(1, cleaned.length - 1)
                          .trim()
                      }
                      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                        cleaned = cleaned
                          .substring(1, cleaned.length - 1)
                          .trim()
                      }
                      return cleaned
                    }
                    return item
                  })
                }
              }
              // Handle comma-separated values (most common format for halftimeBonus)
              else if (
                cleanedAnswer.includes(',') &&
                !cleanedAnswer.includes(';') &&
                !cleanedAnswer.startsWith('{')
              ) {
                parsedAnswer = cleanedAnswer.split(',').map((a) => {
                  let cleaned = a.trim()
                  // Clean quotes and braces
                  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                    cleaned = cleaned.substring(1, cleaned.length - 1).trim()
                  }
                  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                    cleaned = cleaned.substring(1, cleaned.length - 1).trim()
                  }
                  return cleaned
                })
                console.log(
                  'Split halftimeBonus answers by comma:',
                  parsedAnswer
                )
              }
              // Handle semicolon-separated values
              else if (cleanedAnswer.includes(';')) {
                parsedAnswer = cleanedAnswer.split(';').map((a) => {
                  let cleaned = a.trim()
                  // Clean quotes and braces
                  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                    cleaned = cleaned.substring(1, cleaned.length - 1).trim()
                  }
                  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                    cleaned = cleaned.substring(1, cleaned.length - 1).trim()
                  }
                  return cleaned
                })
              }
            } catch (e) {
              console.error('Failed to parse halftimeBonus answers:', e)
              // If JSON parsing fails but we have comma-separated values, split by commas
              if (correctAnswer.includes(',')) {
                parsedAnswer = correctAnswer.split(',').map((a) => a.trim())
                console.log(
                  'Fallback: Split halftimeBonus by commas after parse failure:',
                  parsedAnswer
                )
              } else {
                // Fallback to treating as a single answer
                parsedAnswer = [correctAnswer.trim()]
              }
            }
          }
        } else if (isMultiQuestion) {
          console.log(
            'Processing multiQuestion correct answers:',
            correctAnswer
          )

          // Use our special parser to handle the comma-separated answers
          parsedAnswer = parseMultiQuestionAnswers(correctAnswer)
          console.log('Parsed multiQuestion answers:', parsedAnswer)
        }

        setCorrectAnswer(parsedAnswer)
        setTimeLeft(0)

        // Properly parse the multi-question answers for display in the reveal phase
        if (
          isMultiQuestion &&
          Array.isArray(parsedAnswer) &&
          parsedAnswer.length === 1 &&
          typeof parsedAnswer[0] === 'string'
        ) {
          const answerString = parsedAnswer[0]

          // If it's a single string with comma-separated values inside braces
          if (
            answerString.startsWith('{') &&
            answerString.endsWith('}') &&
            answerString.includes(',')
          ) {
            // Remove the braces and split by commas
            const withoutBraces = answerString.substring(
              1,
              answerString.length - 1
            )
            const splitAnswers = withoutBraces.split(',').map((a) => a.trim())

            // Replace the parsedAnswer with the split array
            console.log('Split multi-question answers by commas:', splitAnswers)
            setCorrectAnswer(splitAnswers)
            parsedAnswer = splitAnswers

            // Update the gameState with the split answers
            updateGameState({
              correctAnswer: splitAnswers,
            })
          }
        }

        if (teamAnswerCorrect !== null) {
          setIsCorrect(teamAnswerCorrect)

          // Determine the appropriate message based on question type
          const lightningMessage = teamAnswerCorrect
            ? 'Lightning Bonus! You earned points!'
            : 'Incorrect lightning answer.'

          const halftimeBonusMessage = teamAnswerCorrect
            ? `Halftime Bonus! You earned ${pointsEarned} ${
                pointsEarned === 1 ? 'point' : 'points'
              }!`
            : 'Incorrect halftime answer.'

          const multiQuestionMessage = teamAnswerCorrect
            ? `You got ${pointsEarned} ${
                pointsEarned === 1 ? 'answer' : 'answers'
              } correct!`
            : 'No correct answers.'

          const regularMessage = teamAnswerCorrect
            ? `Congratulations! You won ${
                gameState.lastSubmittedWager || selectedWager || 0
              } points!`
            : `Ope! You lost ${
                gameState.lastSubmittedWager || selectedWager || 0
              } points.`

          console.log('Setting overlay message for:', {
            isLightningQuestion,
            isHalftimeBonusType,
            isMultiQuestionType,
            pointsEarned,
            teamAnswerCorrect,
          })

          let message
          if (isLightningQuestion) {
            message = lightningMessage
          } else if (isHalftimeBonusType) {
            message = halftimeBonusMessage
          } else if (isMultiQuestionType) {
            message = multiQuestionMessage
          } else {
            message = regularMessage
          }

          setOverlayMessage(message)
          setShowOverlay(true)
          setTimeout(() => {
            setShowOverlay(false)
            setTeamAnswerCorrect(null)
          }, 5000)
        }

        setAnsweredQuestions((prev) => new Set(prev).add(questionId))
        updateGameState({
          currentQuestionId: questionId,
          correctAnswer: Array.isArray(parsedAnswer)
            ? parsedAnswer
            : `${parsedAnswer || ''}`,
          currentPhase: 'reveal',
          timeLeft: 0,
          questionType: isLightningQuestion
            ? 'lightning'
            : isHalftimeBonus
            ? 'halftimeBonus'
            : questionType,
          revealInfo: {
            round: currentRound,
            questionNumber: currentQuestionNumber,
            isLightning: isLightningQuestion,
            isHalftimeBonus: isHalftimeBonus,
          },
        })

        setHasReceivedAnswer(true)
        setHasSignaledReady(false)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
      }
    )

    connection.on('Question', (qData) => {
      console.log('Question event received:', qData)
      if (!qData || !qData.id || answeredQuestions.has(qData.id)) return

      // Make question type determination more robust with case insensitive check
      let questionType = qData.Type || qData.type || 'regular'

      if (typeof questionType === 'string') {
        questionType = questionType.toLowerCase()
        console.log('Normalized question type:', questionType)

        // Handle multi-question case variations
        if (questionType.includes('multi')) {
          console.log('Detected multi-question format from type:', questionType)
          questionType = 'multiQuestion'
        }

        // Handle halftime break variations
        if (
          questionType.includes('halftime') &&
          questionType.includes('break')
        ) {
          console.log('Detected halftime break from type:', questionType)
          questionType = 'halftimeBreak'
        }

        // Handle halftime bonus variations
        if (
          questionType.includes('halftime') &&
          questionType.includes('bonus')
        ) {
          console.log('Detected halftime bonus from type:', questionType)
          questionType = 'halftimeBonus'
        }
      }

      // Handle text field which may now be an array
      let cleanText = ''
      let parsedQuestions = []

      // Handle array of questions directly from the database
      if (Array.isArray(qData.text) && qData.text.length > 0) {
        console.log('Question text is an array from database:', qData.text)

        // Check if the first element looks like a JSON string containing an array
        if (qData.text.length === 1 && typeof qData.text[0] === 'string') {
          const firstElement = qData.text[0]

          // If this looks like a JSON array within a string
          if (
            firstElement.includes('[') ||
            (firstElement.startsWith('{') && firstElement.includes('[')) ||
            (firstElement.startsWith('{') &&
              firstElement.includes('"') &&
              firstElement.includes(','))
          ) {
            try {
              // Try to parse as JSON first by cleaning up
              let jsonStr = firstElement

              // Remove outer curly braces if present
              if (jsonStr.startsWith('{') && jsonStr.endsWith('}')) {
                jsonStr = jsonStr.substring(1, jsonStr.length - 1)
              }

              // Check if it's an array string like ["q1", "q2", ...]
              if (jsonStr.includes('[') && jsonStr.includes(']')) {
                // Try to extract the array part
                const match = jsonStr.match(/\[(.*)\]/)
                if (match && match[1]) {
                  jsonStr = match[1]
                }
              }

              // Add brackets if not present (for comma-separated strings)
              if (!jsonStr.startsWith('[')) {
                jsonStr = '[' + jsonStr + ']'
              }

              // Now try to parse it
              const parsedArray = JSON.parse(jsonStr)
              if (Array.isArray(parsedArray) && parsedArray.length > 0) {
                console.log(
                  'Successfully parsed JSON array from string:',
                  parsedArray
                )
                parsedQuestions = parsedArray.map((q) => {
                  // Clean each question
                  if (typeof q === 'string') {
                    // Remove quotes if present
                    let cleaned = q.trim()
                    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                      cleaned = cleaned.substring(1, cleaned.length - 1)
                    }
                    return cleaned
                  }
                  return q
                })
              }
            } catch (e) {
              console.error('Failed to parse JSON array from string:', e)
              // Fallback to regular cleaning
              parsedQuestions = [parseTextContent(firstElement)]
            }
          } else {
            // Regular text cleaning for non-JSON strings
            parsedQuestions = qData.text.map((q) => parseTextContent(q))
          }
        } else {
          // Multiple array elements, clean each one
          parsedQuestions = qData.text.map((q) => parseTextContent(q))
        }

        // For display purposes, use the first question
        cleanText =
          parsedQuestions.length > 0 ? parsedQuestions[0] : 'Multiple questions'

        // Only set to multiQuestion if explicitly marked as multiQuestion
        if (qData.questionType?.toLowerCase() === 'multiquestion') {
          questionType = 'multiQuestion'
        } else {
          console.log(
            'Regular question with array text, using first element:',
            cleanText
          )
        }
      }
      // Handle string that might contain a JSON array
      else if (typeof qData.text === 'string') {
        cleanText =
          qData.text?.startsWith('"') && qData.text.endsWith('"')
            ? qData.text.substring(1, qData.text.length - 1).trim()
            : qData.text || ''

        // Check if it's a curly-braced format like "{1. What is...}"
        if (cleanText.startsWith('{') && cleanText.endsWith('}')) {
          // Extract the content inside the curly braces
          const extractedText = cleanText
            .substring(1, cleanText.length - 1)
            .trim()
          parsedQuestions.push(extractedText)
          cleanText = extractedText
        }
        // Check if it's a JSON array disguised as a string
        else if (cleanText.startsWith('{') && cleanText.includes('"')) {
          try {
            // This might be a JSON array in this format: {"q1","q2","q3"}
            const textWithoutBraces = cleanText.replace(/^\{|\}$/g, '')
            // Parse the array by handling quoted segments
            let inQuote = false
            let currentQuestion = ''

            for (let i = 0; i < textWithoutBraces.length; i++) {
              const char = textWithoutBraces[i]

              if (char === '"') {
                inQuote = !inQuote
                // Don't include the quote characters
                if (!inQuote && currentQuestion.trim()) {
                  parsedQuestions.push(currentQuestion.trim())
                  currentQuestion = ''
                } else if (inQuote) {
                  // Start a new question without the opening quote
                  currentQuestion = ''
                }
              } else if (char === ',' && !inQuote) {
                // Skip commas between quotes
              } else if (inQuote) {
                currentQuestion += char
              }
            }

            if (parsedQuestions.length > 0) {
              questionType = 'multiQuestion'
              console.log(
                'Parsed questions from JSON-like format:',
                parsedQuestions
              )
            }
          } catch (e) {
            console.error('Error parsing JSON-like question text:', e)
          }
        }
      }

      const questionTextLower = cleanText.toLowerCase()
      // const extractedNumber = extractQuestionNumber(cleanText)
      const hasLightningInText = questionType.includes('lightning')
      // cleanText.includes('Lightning') ||
      // questionTextLower.includes('lightning')
      const isFinalQuestion = questionType.includes('final')
      // cleanText.includes('Final') ||
      // extractedNumber === 25 ||
      // extractedNumber === 24 ||
      // (qData.questionNumber &&
      //   (qData.questionNumber === 25 || qData.questionNumber === 24))

      // Handle questionType which might come as a JSON string instead of a normal string
      if (qData.questionType) {
        let dbType = qData.questionType

        // Check if it's a string with quotes around it like '"regular"'
        if (
          typeof dbType === 'string' &&
          dbType.startsWith('"') &&
          dbType.endsWith('"')
        ) {
          dbType = dbType.substring(1, dbType.length - 1)
        }

        dbType = dbType.toLowerCase()

        // IMPORTANT: Always use the database-specified type first
        questionType = dbType

        // Only override for special cases or backward compatibility
        if (dbType === 'lightning' || hasLightningInText) {
          questionType = 'lightning'
        } else if (
          dbType === 'halftime' ||
          questionTextLower.includes('halftime bonus')
        ) {
          questionType = 'halftimeBonus'
        } else if (dbType === 'final' || isFinalQuestion) {
          questionType = 'finalWager'
        } else if (dbType === 'halftimebreak') {
          questionType = 'halftimeBreak'
        } else if (
          dbType === 'multiquestion' ||
          questionTextLower.includes('fill in the blank')
        ) {
          questionType = 'multiQuestion'
        }
        // We already set the type to dbType above, no need for an else case
      } else if (isFinalQuestion) {
        questionType = 'finalWager'
      } else if (questionTextLower.includes('fill in the blank')) {
        questionType = 'multiQuestion'
      }

      // Only override with these specific keywords
      if (hasLightningInText) questionType = 'lightning'
      if (isFinalQuestion) questionType = 'finalWager'
      if (questionTextLower.includes('halftime bonus'))
        questionType = 'halftimeBonus'

      // DON'T set regular questions to multiQuestion just because they're in an array

      // Important: Being an array should not determine the question type
      // Just use the first element for regular questions
      if (Array.isArray(qData.text) && questionType === 'regular') {
        console.log(
          'Regular question with array text, using first element:',
          qData.text[0]
        )
      }

      const newTimeLeft = questionType === 'halftimeBreak' ? 900 : 150
      setTimeLeft(newTimeLeft)
      updateGameState({
        currentQuestionId: qData.id,
        question: qData,
        correctAnswer: null,
        currentPhase:
          questionType === 'halftimeBreak' ? 'halftimeBreak' : 'question',
        questionType: questionType,
        timeLeft: newTimeLeft,
      })

      setRound(qData.round || 1)
      setQuestionNumber(qData.questionNumber || 1)

      // Set the question text based on whether we have multiple questions or a single one
      if (questionType === 'multiQuestion' && parsedQuestions.length > 0) {
        setQuestionText('Round 5: Fill in the blanks')
      } else {
        setQuestionText(cleanText)
      }

      setSelectedWager(
        questionType === 'finalWager'
          ? 15
          : questionType === 'lightning'
          ? 0
          : null
      )
      setAnswer('')
      setHasReceivedAnswer(false)
      setHasSignaledReady(false)
      setShowOverlay(false)

      if (questionType === 'halftimeBonus') {
        setAnswerOptions([])
        setAnswer(JSON.stringify([]))
        setSelectedWager(0)
        updateGameState({
          currentQuestionId: qData.id,
          questionType: 'halftimeBonus',
          question: { ...qData },
        })
      } else if (questionType === 'multiQuestion') {
        try {
          const questionsData = {}

          // If we already parsed questions from the text, use them
          if (parsedQuestions.length > 0) {
            // Use parsed questions directly
            console.log(
              'Using parsed questions for multiQuestion:',
              parsedQuestions
            )
          }
          // Otherwise try to parse from text
          else if (typeof qData.text === 'string' && qData.text.includes('"')) {
            let cleanText = qData.text
            if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
              cleanText = cleanText.substring(1, cleanText.length - 1)
            }

            if (cleanText.startsWith('{') && cleanText.includes('"')) {
              cleanText = cleanText.replace(/^\{|\}$/g, '')
              let inQuote = false,
                currentQuestion = ''
              for (let i = 0; i < cleanText.length; i++) {
                const char = cleanText[i]
                if (char === '"') {
                  inQuote = !inQuote
                  // Don't add quotes to the question
                  if (inQuote) {
                    // Starting a new question - don't include the quote
                    continue
                  } else if (!inQuote && currentQuestion.trim()) {
                    // Ending a question - don't include the quote
                    parsedQuestions.push(currentQuestion.trim())
                    currentQuestion = ''
                    continue
                  }
                } else if (char === ',' && !inQuote) {
                  // Skip commas between quotes
                  continue
                } else if (inQuote) {
                  currentQuestion += char
                }
              }
            }
          }

          // If we still don't have questions, but we're in multi-question mode,
          // treat a single question as the first of multiple
          if (
            parsedQuestions.length === 0 &&
            questionType === 'multiQuestion'
          ) {
            if (typeof qData.text === 'string') {
              parsedQuestions.push(cleanText)
            } else if (Array.isArray(qData.text) && qData.text.length > 0) {
              parsedQuestions.push(cleanText)
            } else {
              // Create default questions as fallback
              parsedQuestions = Array.from(
                { length: 8 },
                (_, i) => `Question ${i + 1}`
              )
            }
          }

          // Create question objects for UI
          parsedQuestions.forEach((question, index) => {
            questionsData[`q${index + 1}`] = {
              id: `q${index + 1}`,
              text: question,
            }
          })

          // Ensure we have 8 questions
          for (let i = 1; i <= 8; i++) {
            if (!questionsData[`q${i}`])
              questionsData[`q${i}`] = { id: `q${i}`, text: `Question ${i}` }
          }

          setQuestionText('Round 5: Fill in the blanks')
          setAnswerOptions(questionsData)
          const initialAnswers = Object.fromEntries(
            Object.keys(questionsData).map((qid) => [qid, ''])
          )
          setAnswer(JSON.stringify(initialAnswers))
          setSelectedWager(0)

          console.log('Setting parsedQuestionsData:', questionsData)

          updateGameState({
            currentQuestionId: qData.id,
            questionType: 'multiQuestion',
            question: {
              ...qData,
              parsedQuestionsData: questionsData,
            },
          })
        } catch (error) {
          console.error('Error parsing Round 5 questions:', error)
          alert('Error processing Round 5 questions. Please contact support.')
        }
      } else if (Array.isArray(qData.options)) {
        setAnswerOptions(qData.options)
        updateGameState({
          currentQuestionId: qData.id,
          question: { ...qData },
        })
      }
    })

    connection.on(
      'AnswerSubmitted',
      ({ teamId: submittedTeamId, isCorrect, points }) => {
        console.log(
          `Team ${submittedTeamId} answer submitted. Correct: ${isCorrect}, Points: ${points}`
        )
        if (submittedTeamId === teamId) {
          // Set team answer correctness first, BEFORE changing phase
          setTeamAnswerCorrect(isCorrect)

          // Only store scoreChange for halftime bonus and multi-question types
          const questionType = gameState.questionType || 'regular'
          console.log('AnswerSubmitted - question type:', questionType)

          const isHalftimeBonusAnswer =
            questionType === 'halftimeBonus' ||
            (questionType !== 'lightning' &&
              questionType !== 'finalWager' &&
              typeof gameState.question?.text === 'string' &&
              gameState.question.text.toLowerCase().includes('halftime bonus'))

          const isMultiQuestionAnswer =
            questionType === 'multiQuestion' ||
            (questionType !== 'lightning' &&
              questionType !== 'finalWager' &&
              questionType !== 'halftimeBonus' &&
              typeof gameState.question?.text === 'string' &&
              (gameState.question.text
                .toLowerCase()
                .includes('fill in the blank') ||
                gameState.question?.round === 5))

          console.log('AnswerSubmitted type diagnosis:', {
            questionType,
            isHalftimeBonusAnswer,
            isMultiQuestionAnswer,
            points,
            stateScoreChange: gameState.scoreChange,
          })

          if (
            (isHalftimeBonusAnswer || isMultiQuestionAnswer) &&
            points !== undefined
          ) {
            console.log(`Storing points ${points} in gameState.scoreChange`)
            // Update with functional form to avoid state dependencies
            updateGameState((prevState) => ({
              ...prevState,
              scoreChange: points,
            }))
          }

          // Record this question as answered
          if (gameState.currentQuestionId) {
            setAnsweredQuestions((prev) =>
              new Set(prev).add(gameState.currentQuestionId)
            )
          }

          // Only change phase to waitingForAnswers if we're not already in reveal phase
          // This prevents getting stuck in waitingForAnswers when the answer has already been revealed
          setTimeout(() => {
            if (phase !== 'reveal') {
              console.log(
                'Changing to waitingForAnswers phase - not in reveal phase'
              )
              changePhase('waitingForAnswers')
            } else {
              console.log(
                'Already in reveal phase - not changing to waitingForAnswers'
              )
            }
          }, 50)
        }
      }
    )

    connection.on('TeamSignaledReady', (readyTeamId) => {
      if (parseInt(readyTeamId, 10) === teamId) {
        if (phase === 'reveal' || phase === 'halftimeBreak') {
          console.log(`Our team signaled ready during ${phase} phase`)
          setHasSignaledReady(true)
          if (
            phase === 'halftimeBreak' &&
            connection?.state === signalR.HubConnectionState.Connected
          ) {
            console.log('Requesting next question after halftime break')
            connection
              .invoke('RequestNextQuestion', gameId)
              .catch((err) =>
                console.error(
                  'Error requesting next question after halftime:',
                  err
                )
              )
          }
        }
      }
    })

    connection.on('HalftimeBreakExpired', () => {
      console.log('Received HalftimeBreakExpired event')
      if (phase === 'halftimeBreak' && !hasSignaledReady) {
        console.log('Halftime break timer expired, marking team as ready')
        setHasSignaledReady(true)
        // Update game state to show zero time remaining
        updateGameState({
          timeLeft: 0,
        })
        // Set local time state to 0 for immediate UI update
        setTimeLeft(0)
      }
    })

    eventsRegistered.current = true

    return () => {
      if (connection) {
        connection.off('GameStarted')
        connection.off('TeamJoined')
        connection.off('GameState')
        connection.off('GameEnded')
        connection.off('DisplayAnswer')
        connection.off('Question')
        connection.off('AnswerSubmitted')
        connection.off('TeamSignaledReady')
        connection.off('HalftimeBreakExpired')
        eventsRegistered.current = false
        console.log('Unregistered Game component event handlers')
      }
    }
  }, [connection, gameId, gameState.currentQuestionId, phase])

  // Helper to change phase
  const changePhase = (newPhase) => {
    console.log(`Changing phase from ${phase} to ${newPhase}`)
    setPhase(newPhase)
    updateGameState({ currentPhase: newPhase })
  }

  // Handle wager selection
  const handleWagerSelect = (val) => {
    setSelectedWager(val)
    if (connection?.state === signalR.HubConnectionState.Connected) {
      connection
        .invoke('SubmitWager', gameId, teamId, val, gameState.currentQuestionId)
        .catch((err) => console.error('Error sending wager:', err))
    }
  }

  // Fetch active games
  useEffect(() => {
    axios
      .get('https://localhost:7169/api/game/active', {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((resp) => setActiveGames(resp.data))
      .catch((err) => console.error('Error fetching active games:', err))
  }, [token])

  // Join the game
  useEffect(() => {
    if (!gameId || !connection) return

    const joinGameAsync = async () => {
      if (connection.state === signalR.HubConnectionState.Disconnected) {
        console.log('Connection is disconnected, waiting for reconnect')
        return
      }
      try {
        console.log(`Joining game ${gameId} as team ${teamId}`)
        if (gameState.preservedFromToggle) {
          await connection.invoke('JoinGameSilently', gameId, teamId)
        } else {
          await connection.invoke('JoinGame', gameId, teamId)
        }
      } catch (err) {
        console.error('Error joining game:', err)
      }
    }
    joinGameAsync()
  }, [gameId, connection, teamId, gameState.preservedFromToggle])

  // Handle reconnection status
  useEffect(() => {
    if (isReconnecting) {
      setConnectionError('Reconnecting...')
      setReconnecting(true)
    } else if (connection?.state === signalR.HubConnectionState.Connected) {
      setConnectionError(null)
      setReconnecting(false)
    }
  }, [isReconnecting, connection])

  // Timer logic
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (
      (phase === 'question' || phase === 'halftimeBreak') &&
      gameState.timeLeft > 0
    ) {
      console.log(
        `Starting timer for ${phase} phase with ${gameState.timeLeft} seconds remaining`
      )
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          const newTimeLeft = prev - 1

          // Update the gameState.timeLeft in addition to local state
          updateGameState((prevState) => ({
            ...prevState,
            timeLeft: newTimeLeft,
          }))

          if (newTimeLeft <= 0) {
            clearInterval(timerRef.current)
            timerRef.current = null
            if (phase === 'question') {
              const questionType = gameState.questionType || 'regular'
              let effectiveType = questionType
              const questionNumber = gameState.question?.questionNumber || ''
              const questionTextLower = (
                gameState.question?.text || ''
              ).toLowerCase()
              const extractedNumber = extractQuestionNumber(
                gameState.question?.text
              )
              if (
                questionNumber === 10 ||
                extractedNumber === 10 ||
                questionTextLower.includes('lightning')
              ) {
                effectiveType = 'lightning'
              } else if (
                questionNumber === 11 ||
                extractedNumber === 11 ||
                questionTextLower.includes('halftime bonus')
              ) {
                effectiveType = 'halftimeBonus'
              }
              if (effectiveType === 'regular' && !selectedWager) {
                console.log(
                  'Timer expired - auto-selecting wager=1 for regular question'
                )
                handleWagerSelect(1)
              }
              changePhase('waitingForResults')
              if (connection?.state === signalR.HubConnectionState.Connected) {
                connection
                  .invoke(
                    'HandleTimerExpiry',
                    gameId,
                    gameState.currentQuestionId
                  )
                  .catch((err) =>
                    console.error('Error invoking HandleTimerExpiry:', err)
                  )
              }
            } else if (phase === 'halftimeBreak' && !hasSignaledReady) {
              if (connection?.state === signalR.HubConnectionState.Connected) {
                console.log(
                  'Halftime timer expired, signaling ready and requesting next question'
                )

                // First, properly invoke HandleTimerExpiry so the server knows the timer expired
                connection
                  .invoke(
                    'HandleTimerExpiry',
                    gameId,
                    gameState.currentQuestionId
                  )
                  .then(() => {
                    console.log(
                      'Successfully invoked HandleTimerExpiry for halftime break'
                    )

                    // Then signal ready to ensure this team is counted as ready
                    return connection.invoke(
                      'SignalReadyForNext',
                      gameId,
                      teamId
                    )
                  })
                  .then(() => {
                    console.log(
                      'Successfully signaled ready after halftime break'
                    )

                    // The server should auto-advance, but we'll also request next question
                    // as a fallback to ensure we move to Round 5
                    return connection.invoke('RequestNextQuestion', gameId)
                  })
                  .then(() => {
                    console.log(
                      'Successfully requested next question after halftime break'
                    )
                    setHasSignaledReady(true)
                  })
                  .catch((err) =>
                    console.error(
                      'Error in halftime timer expiry sequence:',
                      err
                    )
                  )
              }
            }
            return 0
          }
          return newTimeLeft
        })
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [
    phase,
    selectedWager,
    gameState.currentQuestionId,
    gameState.questionType,
    connection,
    gameId,
    teamId,
    updateGameState,
    selectedWager,
    hasSignaledReady,
  ])

  // Check if stuck in waiting phase
  useEffect(() => {
    if (phase === 'waitingForAnswers' && !hasReceivedAnswer) {
      console.log('Setting up stuck check for waitingForAnswers phase')
      timeoutRef.current = setTimeout(() => {
        if (
          phase === 'waitingForAnswers' &&
          !hasReceivedAnswer &&
          connection?.state === signalR.HubConnectionState.Connected
        ) {
          console.log(
            'Still waiting for answers after timeout, requesting game state'
          )
          connection
            .invoke('RequestGameState', gameId, teamId)
            .catch((err) => console.error('Error requesting game state:', err))
        }
      }, 5000)
      return () => clearTimeout(timeoutRef.current)
    }
  }, [phase, hasReceivedAnswer, connection, gameId, teamId])

  const joinGame = async () => {
    try {
      const payload = {
        teamIds: [teamId],
        gameId: selectedGameId ? parseInt(selectedGameId, 10) : null,
      }
      const resp = await axios.post(
        'https://localhost:7169/api/game/join',
        payload,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const newGameId = resp.data.gameId
      setGameId(newGameId)
      changePhase('waiting')
      updateGameState({ correctAnswer: null, currentQuestionId: null })
      setTimeLeft(0)
      setJoinedTeams([teamId])
    } catch (error) {
      console.error('joinGame error:', error)
      alert(error.response?.data?.error || error.message)
    }
  }

  const startGame = async () => {
    try {
      await axios.post(
        'https://localhost:7169/api/game/start',
        { gameId },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
    } catch (err) {
      console.error('startGame error:', err)
      alert(err.response?.data?.error || err.message)
    }
  }

  // Updated submitAnswer to handle both answer and wager
  const submitAnswer = useCallback(
    async (submittedAnswer, submittedWager = null) => {
      console.log('submitAnswer called with:', {
        submittedAnswer,
        submittedWager,
        questionType: gameState.questionType,
      })

      // Clean the submitted answer(s) first
      let cleanedSubmittedAnswer = submittedAnswer
      if (typeof submittedAnswer === 'string') {
        cleanedSubmittedAnswer = parseTextContent(submittedAnswer)
        console.log('Cleaned submitted answer:', cleanedSubmittedAnswer)
      } else if (Array.isArray(submittedAnswer)) {
        cleanedSubmittedAnswer = submittedAnswer.map((ans) =>
          typeof ans === 'string' ? parseTextContent(ans) : ans
        )
        console.log('Cleaned submitted answer array:', cleanedSubmittedAnswer)
      }

      // Game state checks
      if (!gameState || !gameState.question) {
        console.error('Cannot submit answer - no active question')
        return
      }

      // Determine question type
      const questionType = gameState.questionType || 'regular'
      let effectiveType = questionType

      // Override type based on specific indicators
      const questionNumber = gameState.question?.questionNumber || ''

      // Handle questionText which might be an array
      const questionTextLower =
        typeof questionText === 'string'
          ? questionText.toLowerCase()
          : Array.isArray(questionText) && questionText.length > 0
          ? questionText[0].toLowerCase()
          : ''

      const extractedNumber = extractQuestionNumber(
        typeof questionText === 'string'
          ? questionText
          : Array.isArray(questionText) && questionText.length > 0
          ? questionText[0]
          : ''
      )

      const hasLightningInText =
        typeof questionText === 'string'
          ? questionText.includes('Lightning') ||
            questionTextLower.includes('lightning')
          : false

      const isFinalQuestion = gameState.questionType.includes('final')
      // questionTextLower.includes('final') ||
      // extractedNumber === 25 ||
      // extractedNumber === 24

      const isHalftimeBonus = questionTextLower.includes('halftime bonus')

      if (questionNumber === 10 || extractedNumber === 10 || hasLightningInText)
        effectiveType = 'lightning'
      else if (isHalftimeBonus) effectiveType = 'halftimeBonus'
      else if (isFinalQuestion) effectiveType = 'finalWager'

      let finalWager = 0
      if (effectiveType === 'regular' || effectiveType === 'finalWager') {
        if (submittedWager === null) {
          alert('Please select a wager')
          return
        }
        finalWager = submittedWager

        // Store the wager in gameState so we can use it in the overlay
        updateGameState({
          lastSubmittedWager: submittedWager,
        })
      }

      if (!cleanedSubmittedAnswer) {
        alert('Please select an answer')
        return
      }

      let finalAnswer = cleanedSubmittedAnswer

      // For regular questions, enclose the answer in curly braces to match the server's expected format
      if (effectiveType === 'regular') {
        // If not already in curly braces, add them
        if (
          typeof finalAnswer === 'string' &&
          !(finalAnswer.startsWith('{') && finalAnswer.endsWith('}'))
        ) {
          console.log(
            'Formatting regular answer in curly braces to match server format:',
            finalAnswer
          )
          finalAnswer = `{${finalAnswer}}`
        }
      }

      // Handle halftime bonus answers (array format)
      if (effectiveType === 'halftimeBonus') {
        try {
          console.log(
            'Processing halftimeBonus answer:',
            cleanedSubmittedAnswer
          )
          let answers = []

          if (typeof cleanedSubmittedAnswer === 'string') {
            try {
              if (
                cleanedSubmittedAnswer.startsWith('{') ||
                cleanedSubmittedAnswer.startsWith('[')
              ) {
                const parsed = JSON.parse(cleanedSubmittedAnswer)
                if (
                  parsed &&
                  typeof parsed === 'object' &&
                  !Array.isArray(parsed)
                ) {
                  answers = Object.values(parsed)
                    .map((a) =>
                      typeof a === 'string' ? a.trim() : a?.toString?.() || ''
                    )
                    .filter((a) => a.length > 0)
                } else if (Array.isArray(parsed)) {
                  answers = parsed
                    .map((a) =>
                      typeof a === 'string' ? a.trim() : a?.toString?.() || ''
                    )
                    .filter((a) => a.length > 0)
                }
              } else if (cleanedSubmittedAnswer.includes(',')) {
                answers = cleanedSubmittedAnswer
                  .split(',')
                  .map((a) => a.trim())
                  .filter((a) => a.length > 0)
              } else if (cleanedSubmittedAnswer.trim().length > 0) {
                answers = [cleanedSubmittedAnswer.trim()]
              }
            } catch (e) {
              console.error('Error parsing halftimeBonus answers JSON:', e)
              if (cleanedSubmittedAnswer.includes(',')) {
                answers = cleanedSubmittedAnswer
                  .split(',')
                  .map((a) => a.trim())
                  .filter((a) => a.length > 0)
              } else {
                answers = [cleanedSubmittedAnswer.trim()]
              }
            }
          } else if (Array.isArray(cleanedSubmittedAnswer)) {
            answers = cleanedSubmittedAnswer
              .map((a) =>
                typeof a === 'string' ? a.trim() : a?.toString?.() || ''
              )
              .filter((a) => a.length > 0)
          }

          console.log('Processed halftimeBonus answers:', answers)
          if (answers.length === 0) {
            alert('Please enter at least one answer')
            return
          }
          finalAnswer = JSON.stringify(answers)
        } catch (e) {
          console.error('Error formatting halftime answers:', e)
          finalAnswer = JSON.stringify([cleanedSubmittedAnswer])
        }
      }
      // Handle lightning question answers - they also need curly braces
      else if (effectiveType === 'lightning') {
        // Make sure lightning answers also have curly braces
        if (
          typeof finalAnswer === 'string' &&
          !(finalAnswer.startsWith('{') && finalAnswer.endsWith('}'))
        ) {
          console.log(
            'Formatting lightning answer in curly braces:',
            finalAnswer
          )
          finalAnswer = `{${finalAnswer}}`
        }
      }
      // Handle multiQuestion answers (Round 5)
      else if (effectiveType === 'multiQuestion') {
        try {
          console.log(
            'Processing multiQuestion answer:',
            cleanedSubmittedAnswer
          )

          // Convert comma-separated key-value pairs into an object
          const parsedAnswers = {}
          cleanedSubmittedAnswer.split(',').forEach((pair) => {
            const [key, ...rest] = pair.split(':')
            if (key && rest.length) {
              parsedAnswers[key.trim()] = rest.join(':').trim()
            }
          })

          console.log('Parsed answers object:', parsedAnswers)

          // Correctly accessing properties
          const answersArray = Array.from(
            { length: 8 },
            (_, i) => parsedAnswers[`q${i + 1}`]?.trim() || ''
          )

          if (!answersArray.some((a) => a)) {
            alert('Please enter at least one answer')
            return
          }

          finalAnswer = JSON.stringify(
            answersArray.map((a) => {
              if (
                a &&
                typeof a === 'string' &&
                !(a.startsWith('{') && a.endsWith('}'))
              ) {
                return `{${a}}`
              }
              return a || ''
            })
          )
        } catch (e) {
          console.error('Error processing multiQuestion answer:', e)
          finalAnswer = cleanedSubmittedAnswer
        }
      }

      console.log(
        `Submitting answer: answer=${finalAnswer}, wager=${finalWager}`
      )
      try {
        await connection.invoke(
          'SubmitAnswer',
          gameId,
          teamId,
          gameState.currentQuestionId,
          finalAnswer,
          finalWager
        )
        console.log('Answer submitted successfully')
      } catch (err) {
        console.error('Error submitting answer:', err)
        alert(`Error submitting answer: ${err.message}`)
      }
    },
    [connection, gameId, gameState, phase]
  )

  const signalReadyForNext = async () => {
    if (connection?.state === signalR.HubConnectionState.Connected) {
      try {
        console.log(
          `Signaling ready for next question (current phase: ${phase})`
        )
        await connection.invoke('SignalReadyForNext', gameId, teamId)
        setHasSignaledReady(true)
        if (phase === 'halftimeBreak') advanceFromHalftimeBreak()
      } catch (err) {
        console.error('Error signaling ready:', err)
      }
    }
  }

  const advanceFromHalftimeBreak = async () => {
    if (connection?.state === signalR.HubConnectionState.Connected) {
      try {
        console.log('Manually advancing from halftime break')
        if (!hasSignaledReady) {
          await connection.invoke('SignalReadyForNext', gameId, teamId)
          setHasSignaledReady(true)
        }
        await connection.invoke('RequestNextQuestion', gameId)
        setTimeout(() => {
          if (phase === 'halftimeBreak') {
            console.log(
              'Still in halftime break, requesting game state refresh'
            )
            connection
              .invoke('RequestGameState', gameId, teamId)
              .catch((err) =>
                console.error('Error requesting game state:', err)
              )
            setTimeout(() => {
              if (phase === 'halftimeBreak') {
                console.log(
                  'Forcing phase change from halftime break to question'
                )
                changePhase('question')
              }
            }, 2000)
          }
        }, 2000)
      } catch (err) {
        console.error('Error advancing from halftime break:', err)
      }
    }
  }

  const extractQuestionNumber = (text) => {
    if (!text) return null
    const match = text.match(/^\s*(\d+)[.:]\s*/)
    return match ? parseInt(match[1], 10) : null
  }

  // Reuse this function for both parsing and preparing question props
  const parseTextContent = (text) => {
    console.log('parseTextContent called with:', text)

    if (!text) return ''

    let cleanText = text

    // Handle string format
    if (typeof cleanText === 'string') {
      // Remove curly braces if present
      if (cleanText.startsWith('{') && cleanText.endsWith('}')) {
        console.log('Removing curly braces from text')
        cleanText = cleanText.substring(1, cleanText.length - 1).trim()
      }

      if (/['"]/.test(cleanText)) {
        console.log('Removing quotes from text')
        cleanText = cleanText.replace(/['"]/g, '').trim()
      }
      // Remove quotes if present
      // if (
      //   (cleanText.startsWith('"') && cleanText.endsWith('"')) ||
      //   (cleanText.startsWith("'") && cleanText.endsWith("'"))
      // ) {
      //   console.log('Removing quotes from text')
      //   cleanText = cleanText.substring(1, cleanText.length - 1).trim()
      // }
    }

    console.log('parseTextContent returning:', cleanText)
    return cleanText
  }

  // For all non-multiQuestion types, ensure the question prop gets the first element if it's an array
  const prepareQuestionProp = useMemo(() => {
    const processor = (questionData) => {
      if (!questionData) return null

      const result = { ...questionData }

      // Handle question text
      if (Array.isArray(result.text) && result.text.length > 0) {
        result.text = parseTextContent(result.text[0])
      } else if (typeof result.text === 'string') {
        result.text = parseTextContent(result.text)
      }

      // Handle question options
      if (Array.isArray(result.options)) {
        // Case 1: Single string with comma-separated values in curly braces
        if (
          result.options.length === 1 &&
          typeof result.options[0] === 'string'
        ) {
          const optionText = result.options[0]

          if (optionText.startsWith('{') && optionText.endsWith('}')) {
            // Extract and split the content
            const content = optionText.substring(1, optionText.length - 1)

            // Split by commas, clean up, and filter empty strings
            const cleanOptions = content
              .split(',')
              .map((opt) => opt.trim())
              .filter((opt) => opt.length > 0)

            result.options = cleanOptions
          }
        } else {
          // Case 2: Array of options that may need individual cleaning
          result.options = result.options.map((opt) => {
            if (typeof opt === 'string') {
              return parseTextContent(opt)
            }
            return opt
          })
        }
      }

      return result
    }

    return processor
  }, [])

  // For Round 5 multiQuestion type, parse the comma-separated answers
  const parseMultiQuestionAnswers = (answers) => {
    if (!answers) return []

    // If it's just a single string with comma-separated values inside curly braces
    if (
      Array.isArray(answers) &&
      answers.length === 1 &&
      typeof answers[0] === 'string'
    ) {
      const answerStr = answers[0]

      // Check if it's in {answer1,answer2,...} format
      if (answerStr.startsWith('{') && answerStr.endsWith('}')) {
        const withoutBraces = answerStr.substring(1, answerStr.length - 1)
        return withoutBraces.split(',').map((a) => a.trim())
      }

      // Or just comma-separated without braces
      if (answerStr.includes(',')) {
        return answerStr.split(',').map((a) => a.trim())
      }
    }

    return answers
  }

  // Render logic
  if (!gameId) {
    return (
      <div className='game-container'>
        <h2>Join or Create a Game</h2>
        <label>
          Existing Game:
          <select
            value={selectedGameId}
            onChange={(e) => setSelectedGameId(e.target.value)}
          >
            <option value=''>Create New Game</option>
            {activeGames.map((g) => (
              <option key={g.id} value={g.id}>
                Game {g.id} - created at{' '}
                {new Date(g.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <button onClick={joinGame}>Join Game</button>
        {connectionError && <p style={{ color: 'red' }}>{connectionError}</p>}
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'waiting') {
    return (
      <div className='game-container'>
        <h2>Game {gameId}: Waiting</h2>
        <p>Teams joined: {joinedTeams.join(', ')}</p>
        <button onClick={startGame}>Start Game</button>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'waitingForAnswers') {
    return (
      <div className='game-container'>
        <h2>Game {gameId}: Waiting for other teams</h2>
        <h3>
          Round {round}: Question {questionNumber}
        </h3>
        <p>You&apos;ve submitted your answer.</p>
        <p>Waiting for other teams to submit their answers...</p>
        {hasReceivedAnswer ? (
          <div className='answer-display'>
            <h3>{gameState.correctAnswer}</h3>
          </div>
        ) : (
          <div className='spinner-border' role='status'>
            <span className='visually-hidden'>Loading...</span>
          </div>
        )}
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'idle') {
    return (
      <div className='game-container'>
        <h2>Game {gameId}: Idle</h2>
        <button onClick={startGame}>Start Game</button>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (connectionError) {
    return (
      <div className='game-container'>
        <h2>Error</h2>
        <p>{connectionError}</p>
        <button onClick={onLogout}>Logout</button>
      </div>
    )
  }

  if (phase === 'question') {
    // Add safety check in case gameState is undefined
    if (!gameState) {
      console.error('gameState is undefined in question phase')
      return (
        <div className='game-container'>
          <h2>Error: Game state missing</h2>
          <p>
            There was an error loading the game state. Please try refreshing.
          </p>
          <button className='logout_button' onClick={onLogout}>
            Logout
          </button>
        </div>
      )
    }

    const questionType = gameState.questionType || 'regular'
    const questionNumber = gameState.question?.questionNumber || ''

    // Check if we have question data before trying to render question components
    if (!gameState.question) {
      return (
        <div className='game-container'>
          {reconnecting && <p>Reconnecting…</p>}
          <h2>Loading question...</h2>
          <p>Waiting for question data...</p>
          <button className='logout_button' onClick={onLogout}>
            Logout
          </button>
        </div>
      )
    }

    // Handle questionText which might be an array
    const questionTextLower =
      typeof questionText === 'string'
        ? questionText.toLowerCase()
        : Array.isArray(questionText) && questionText.length > 0
        ? questionText[0].toLowerCase()
        : ''

    const extractedNumber = extractQuestionNumber(
      typeof questionText === 'string'
        ? questionText
        : Array.isArray(questionText) && questionText.length > 0
        ? questionText[0]
        : ''
    )

    const hasLightningInText =
      typeof questionText === 'string'
        ? questionText.includes('Lightning') ||
          questionTextLower.includes('lightning')
        : false

    const isFinalQuestion = gameState.questionType.includes('final')
    // questionTextLower.includes('final') ||
    // extractedNumber === 25 ||
    // extractedNumber === 24

    const isHalftimeBonus = questionTextLower.includes('halftime bonus')

    // CRITICAL CHANGE: Prioritize the question type from gameState and only override in specific cases
    let effectiveType = questionType

    // Only override in very specific cases with strong indicators
    if (questionNumber === 10 || extractedNumber === 10 || hasLightningInText)
      effectiveType = 'lightning'
    else if (isHalftimeBonus) effectiveType = 'halftimeBonus'
    else if (isFinalQuestion) effectiveType = 'finalWager'

    // DON'T automatically set to multiQuestion for Round 5
    // Only if it's already set that way from the database

    // Question rendering
    if (effectiveType === 'lightning') {
      return (
        <LightningQuestion
          question={prepareQuestionProp(gameState.question)}
          onSubmit={(answer) => submitAnswer(answer)}
          timeLeft={gameState.timeLeft}
          reconnecting={reconnecting}
          onLogout={onLogout}
        />
      )
    } else if (effectiveType === 'halftimeBreak') {
      return (
        <div className='game-container'>
          {reconnecting && <p>Reconnecting…</p>}
          <h2>Halftime Break</h2>
          <h3>Take a short break before continuing</h3>
          <p>This is the halftime break. Teams can take a 15-minute break.</p>
          <p>Time remaining: {gameState.timeLeft} seconds</p>
          <button className='logout_button' onClick={onLogout}>
            Logout
          </button>
        </div>
      )
    } else if (effectiveType === 'halftimeBonus') {
      return (
        <HalftimeBonusQuestion
          question={prepareQuestionProp(gameState.question)}
          onSubmit={(answers) => submitAnswer(answers)}
          timeLeft={gameState.timeLeft}
          reconnecting={reconnecting}
          onLogout={onLogout}
        />
      )
    } else if (effectiveType === 'multiQuestion') {
      return (
        <MultiQuestion
          question={gameState.question}
          onSubmit={(answers) => submitAnswer(answers)}
          timeLeft={gameState.timeLeft}
          reconnecting={reconnecting}
          onLogout={onLogout}
        />
      )
    } else if (effectiveType === 'finalWager') {
      return (
        <FinalWagerQuestion
          question={prepareQuestionProp(gameState.question)}
          onSubmit={(answer, wager) => submitAnswer(answer, wager)}
          timeLeft={gameState.timeLeft}
          reconnecting={reconnecting}
          onLogout={onLogout}
        />
      )
    } else {
      return (
        <RegularQuestion
          question={prepareQuestionProp(gameState.question)}
          onSubmit={(answer, wager) => submitAnswer(answer, wager)}
          timeLeft={gameState.timeLeft}
          reconnecting={reconnecting}
          onLogout={onLogout}
        />
      )
    }
  }

  if (phase === 'waitingForResults') {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>
          Round {round}: Question {questionNumber}
        </h3>
        <p>Your answer has been submitted. Waiting for results…</p>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'reveal') {
    const wasLightningQuestion =
      gameState.questionType === 'lightning' ||
      (gameState.revealInfo && gameState.revealInfo.isLightning)
    const wasHalftimeBonus =
      gameState.questionType === 'halftimeBonus' ||
      (gameState.revealInfo && gameState.revealInfo.isHalftimeBonus)
    const wasMultiQuestion =
      gameState.questionType === 'multiQuestion' ||
      (gameState.revealInfo && gameState.revealInfo.isMultiQuestion)
    const displayRound = gameState.revealInfo?.round || round
    const displayQuestionNumber =
      gameState.revealInfo?.questionNumber || questionNumber

    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h3>
          {wasLightningQuestion
            ? 'Lightning Bonus Question Results'
            : wasHalftimeBonus
            ? 'Halftime Bonus Results'
            : wasMultiQuestion
            ? 'Round 5 Results'
            : `Round ${displayRound}: Question ${displayQuestionNumber} Results`}
        </h3>
        <br />
        {correctAnswer && (
          <div className='correct-answer-display'>
            <p>
              <b>
                Correct Answer
                {Array.isArray(correctAnswer) && correctAnswer.length > 1
                  ? 's'
                  : ''}
                :
              </b>
            </p>
            {Array.isArray(correctAnswer) ? (
              gameState.questionType === 'multiQuestion' ? (
                <div className='multi-question-answers'>
                  {gameState.question?.parsedQuestionsData ? (
                    Object.keys(gameState.question.parsedQuestionsData).map(
                      (key, index) => {
                        const question =
                          gameState.question.parsedQuestionsData[key]
                        let answer = correctAnswer[index] || ''
                        // Clean quotes from answer string
                        if (typeof answer === 'string') {
                          answer = answer.replace(/^"|"$/g, '')
                        }
                        return (
                          <div key={key} className='multi-question-answer-item'>
                            <p>
                              <strong>{question.text}</strong>
                            </p>
                            <p>Answer: {answer}</p>
                          </div>
                        )
                      }
                    )
                  ) : (
                    <ul className='answer-list'>
                      {Array.isArray(gameState.question?.text)
                        ? // Map each question to its corresponding answer
                          gameState.question.text.map((questionText, idx) => {
                            const cleanedQuestionText =
                              typeof questionText === 'string'
                                ? questionText.replace(/^"|"$/g, '')
                                : questionText
                            const answer = correctAnswer[idx] || ''
                            const cleanedAnswer =
                              typeof answer === 'string'
                                ? answer.replace(/^"|"$/g, '')
                                : answer
                            return (
                              <li key={idx}>
                                <p>
                                  <strong>{cleanedQuestionText}</strong>
                                </p>
                                <p>Answer: {cleanedAnswer}</p>
                              </li>
                            )
                          })
                        : // Fallback for when question text isn't an array
                          correctAnswer.map((ans, idx) => {
                            let cleanedAns =
                              typeof ans === 'string'
                                ? ans.replace(/^"|"$/g, '')
                                : ans
                            return (
                              <li key={idx} className='halftime-answer-item'>
                                {cleanedAns}
                              </li>
                            )
                          })}
                    </ul>
                  )}
                </div>
              ) : (
                <ul className='halftime-answer-list'>
                  {correctAnswer.map((ans, idx) => {
                    let cleanedAns =
                      typeof ans === 'string' ? ans.replace(/^"|"$/g, '') : ans
                    return (
                      <li key={idx} className='halftime-answer-item'>
                        {cleanedAns}
                      </li>
                    )
                  })}
                </ul>
              )
            ) : typeof correctAnswer === 'object' ? (
              <ul className='halftime-answer-list'>
                {Object.values(correctAnswer).map((ans, idx) => {
                  let cleanedAns =
                    typeof ans === 'string' ? ans.replace(/^"|"$/g, '') : ans
                  return (
                    <li key={idx} className='halftime-answer-item'>
                      {cleanedAns}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p>
                {typeof correctAnswer === 'string'
                  ? correctAnswer.replace(/^\{|\}$/g, '').replace(/^"|"$/g, '')
                  : correctAnswer}
              </p>
            )}
          </div>
        )}
        {showOverlay && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: isCorrect
                ? 'rgba(0, 255, 0, 0.5)'
                : 'rgba(255, 0, 0, 0.5)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 1000,
            }}
          >
            <h2 className='overlay_message'>{overlayMessage}</h2>
            {isCorrect && <Confetti />}
          </div>
        )}
        <br />
        <br />
        <p>Waiting for teams to signal ready...</p>
        <button
          className='next_question_button'
          onClick={signalReadyForNext}
          disabled={hasSignaledReady}
          style={{
            backgroundColor: hasSignaledReady ? '#4CAF50' : '',
            color: hasSignaledReady ? 'white' : '',
          }}
        >
          {hasSignaledReady ? 'Ready!' : 'Ready for Next Question'}
        </button>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'ended') {
    return (
      <div className='game-container'>
        <h2>Game Over</h2>
        <p>The game has ended. Thanks for playing!</p>
        <button
          onClick={() => {
            setGameId(null)
            changePhase('idle')
          }}
        >
          Back to Lobby
        </button>
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  if (phase === 'halftimeBreak') {
    return (
      <div className='game-container'>
        {reconnecting && <p>Reconnecting…</p>}
        <h2>Halftime Break</h2>
        <p className='halftime-message'>
          Take a 15-minute break before the second half begins!
        </p>
        <div className='timer-container'>
          <p className='big-timer'>
            {Math.floor(gameState.timeLeft / 60)}:
            {(gameState.timeLeft % 60).toString().padStart(2, '0')}
          </p>
        </div>
        <p className='halftime-message'>
          Coming up after the break: Round 5 with 8 fill-in-the-blank questions!
        </p>
        <p>Click &quot;Ready&quot; when your team is ready to continue.</p>
        <button
          className='next_question_button'
          onClick={signalReadyForNext}
          disabled={hasSignaledReady}
          style={{
            backgroundColor: hasSignaledReady ? '#4CAF50' : '',
            color: hasSignaledReady ? 'white' : '',
            padding: '12px 24px',
            fontSize: '1.2rem',
            margin: '20px 0',
          }}
        >
          {hasSignaledReady ? 'Ready!' : 'Ready to Continue'}
        </button>
        {hasSignaledReady && (
          <button
            onClick={advanceFromHalftimeBreak}
            style={{
              backgroundColor: '#2196F3',
              color: 'white',
              padding: '12px 24px',
              fontSize: '1.2rem',
              margin: '10px 0',
            }}
          >
            Advance to Next Round
          </button>
        )}
        <button className='logout_button' onClick={onLogout}>
          Logout
        </button>
      </div>
    )
  }

  return (
    <div className='game-container'>
      <p>Loading…</p>
      <button className='logout_button' onClick={onLogout}>
        Logout
      </button>
    </div>
  )
}

Game.propTypes = {
  token: PropTypes.string.isRequired,
  gameId: PropTypes.number,
  setGameId: PropTypes.func.isRequired,
  onLogout: PropTypes.func.isRequired,
  connection: PropTypes.object,
  isReconnecting: PropTypes.bool,
  gameState: PropTypes.object.isRequired,
  updateGameState: PropTypes.func.isRequired,
}

export default Game
