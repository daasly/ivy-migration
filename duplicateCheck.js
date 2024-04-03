import users from './from-data/users.json' assert { type: 'json' }

const emailOccurrences = users.reduce((acc, user) => {
  // Convert email to lowercase to ensure case-insensitive comparison
  const emailLower = user.email.toLowerCase()
  acc[emailLower] = (acc[emailLower] || 0) + 1
  return acc
}, {})

const duplicateEmails = Object.keys(emailOccurrences).filter(
  (email) => emailOccurrences[email] > 1
)

console.log(duplicateEmails)
