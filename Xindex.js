import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

import processClients from './index.js'
// import createAssignments from './createAssignments.js'

initializeApp({ projectId: 'fm-hedera-dev' })

const db = getFirestore()
const auth = getAuth()

await processClients(db, auth)
// const newAssignments = await createAssignments(db)
