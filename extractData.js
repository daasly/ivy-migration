import admin from 'firebase-admin'
import serviceAccount from './twin-bee-private-key.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'json2csv'

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

const db = admin.firestore()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const directoryPath = path.join(__dirname, 'from-data')

const extractData = async (col, format = 'json') => {
  const usersRef = db.collection(col)
  const snapshot = await usersRef.get()
  const docs = snapshot.docs

  const usersData = docs.map((doc) => {
    return { docId: doc.id, ...doc.data() }
  })

  const filePath = path.join(directoryPath, `${col}.${format}`)

  if (format === 'json') {
    fs.writeFile(filePath, JSON.stringify(usersData, null, 2), (err) => {
      if (err) {
        console.error(`Failed to write data to ${col}.json:`, err)
      } else {
        console.log(`Data successfully written to ${col}.json`)
      }
    })
  } else if (format === 'csv') {
    try {
      const csv = parse(usersData)
      fs.writeFileSync(filePath, csv)
      console.log(`Data successfully written to ${col}.csv`)
    } catch (err) {
      console.error(`Failed to write data to ${col}.csv:`, err)
    }
  }

  return
}

export default extractData

// Example usage
// const collections = ['assignments', 'reloads', 'subscriptions', 'users']
const collections = ['users']

collections.forEach(async (collection) => {
  // await extractData(collection, 'json')
  await extractData(collection, 'csv')
})
