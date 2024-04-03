import { Timestamp } from 'firebase-admin/firestore'
import assignments from './from-data/assignments.json' assert { type: 'json' }

const delay = (ms) => new Promise((res) => setTimeout(res, ms))

const createAssignments = async (db) => {
  // ADJUST WHEN LIUVE
  // Slicing assginments for testing purposes
  const reducedAssignments = assignments.slice(0, 10)

  console.log(reducedAssignments)
}

export default createAssignments
