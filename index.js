import admin from 'firebase-admin'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { parseFullName } from 'parse-full-name'
import Stripe from 'stripe'
import Decimal from 'decimal.js'
import dayjs from 'dayjs'

import users from './from-data/test-users.json' assert { type: 'json' }
import assignments from './from-data/assignments.json' assert { type: 'json' }
import reloads from './from-data/reloads.json' assert { type: 'json' }
import subscriptions from './from-data/subscriptions.json' assert { type: 'json' }

import serviceAccount from './ivy-private-key.js'

// Used for emulators
// initializeApp({ projectId: 'fm-hedera-dev' })
initializeApp({
  credential: admin.credential.cert(serviceAccount)
})

const db = getFirestore()
const auth = getAuth()
const delay = () => new Promise((res) => setTimeout(res, 10))
const stripe = Stripe('')

const createStripeCustomer = async (email) => {
  try {
    const customer = await stripe.customers.create({
      email
    })

    return customer.id
  } catch (error) {
    console.error('Error creating Stripe customer:', error)
    throw error
  }
}

const getAllPaymentMethods = async (customerId) => {
  try {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card'
    })

    const paymentMethodIds = paymentMethods.data.map((pm) => {
      const obj = {
        id: pm.id,
        type: pm.type,
        last4: pm.card.last4,
        brand: pm.card.brand,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year
      }
      return obj
    })
    return paymentMethodIds
  } catch (error) {
    console.error('Error fetching payment methods:', error)
    throw error
  }
}

const getUserStatus = ({ isActive, isAuth }) => {
  if (isActive && isAuth) {
    return 'PENDING'
  } else {
    return 'ARCHIVED'
  }
}

const getUserRole = (currRole) => {
  switch (currRole) {
    case 'customer':
      return 'CLIENT'
    case 'employee':
      return 'CONTRACTOR'
    case 'admin':
      return 'ADMIN'
    default:
      return 'UNKNOWN'
  }
}

const getAssignmentStatus = (isDeleted, isActive, balance) => {
  if (balance < 0) {
    return 'Negative Balance'
  } else if (isDeleted) {
    return 'Archived'
  } else if (isActive) {
    return 'Active'
  } else {
    return 'Archived'
  }
}

const getSubscriptionStatus = (isDeleted, isActive) => {
  if (isDeleted) {
    return 'Paused'
  } else if (isActive) {
    return 'Active'
  } else {
    return 'Paused'
  }
}

const getNextLoad = () => {
  const now = dayjs()
  const nextLoadDate = now.add(1, 'month').toDate()
  return Timestamp.fromDate(nextLoadDate)
}

const runMigration = async () => {
  const adminRef = db.collection('users').doc('bNNyWi1RlJKMbwFN4O0TQSgk6Dli')

  let newUsers = []
  for (const user of users) {
    let authRecord

    if (user.uid) {
      authRecord = await auth.createUser({
        uid: user.uid,
        displayName: user.name,
        email: user.email,
        disabled: false
      })
      await auth.setCustomUserClaims(user.uid, { role: 'CLIENT' })
      console.log(`Auth user created with id ${user.uid}`)
    } else {
      authRecord = await auth.createUser({
        displayName: user.name,
        email: user.email,
        disabled: false
      })

      await auth.setCustomUserClaims(authRecord.uid, { role: 'CLIENT' })
      user.uid = authRecord.uid
      console.log(`Auth user created with id ${authRecord.uid}`)
    }

    const parseFullNameResult = parseFullName(user.name || '')

    const userDoc = {
      prevId: user.id,
      role: getUserRole(user.appRole),
      name: {
        first: parseFullNameResult.first,
        last: parseFullNameResult.last
      },
      displayName: user.name,
      email: user.email,
      phone: user.phone,
      address: {
        street: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      },
      status: getUserStatus({ isActive: user.isActive, isAuth: user.isAuth }),
      created: Timestamp.now(),
      createdBy: adminRef,
      updated: Timestamp.now(),
      updatedBy: adminRef
    }

    await db.collection('users').doc(user.uid).set(userDoc)
    console.log(`User created with id ${user.uid}`)

    newUsers.push({
      uid: user.uid,
      stripeCustomerId: user.stripeCustomerId,
      ...userDoc
    })

    await delay()
  }

  const clients = newUsers.filter((user) => user.role === 'CLIENT')
  const contractors = newUsers.filter((user) => user.role === 'CONTRACTOR')

  for (const client of clients) {
    const accountRef = db.collection('accounts').doc()
    const accountDoc = {
      name: client.displayName,
      address: {
        street: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      },
      billingEmail: client.email,
      type: 'Person',
      users: [db.collection('users').doc(client.uid)],
      opportunities: [],
      assignments: [],
      stripeCustomerId: client.stripeCustomerId || '',
      created: Timestamp.now(),
      createdBy: adminRef,
      updated: Timestamp.now(),
      updatedBy: adminRef
    }

    const clientAssignments = assignments.filter(
      (assignment) => assignment.customerId === client.prevId
    )

    for (const assignment of clientAssignments) {
      const assignmentRef = db.collection('assignments').doc(assignment.docId)
      accountDoc.assignments.push(assignmentRef)

      const contractor = contractors.find(
        (contractor) => contractor.prevId === assignment.employeeId
      )

      const availableHours = new Decimal(assignment.availableHours)
      const rate = new Decimal(assignment.rate)
      const cost = new Decimal(assignment.cost)

      const assignmentDoc = {
        prevId: assignment.id,
        accountRef: accountRef,
        userRef: db.collection('users').doc(contractor.uid),
        balance: Number(availableHours.toFixed(2)),
        rate: Number(rate.toFixed(2)),
        cost: Number(cost.toFixed(2)),
        status: getAssignmentStatus(
          assignment.isDeleted,
          assignment.isActive,
          Number(availableHours.toFixed(2))
        ),
        created: Timestamp.now(),
        createdBy: adminRef,
        updated: Timestamp.now(),
        updatedBy: adminRef
      }

      if (assignment.hasReload) {
        const reload = reloads.find(
          (reload) => reload.assignmentId === assignment.id
        )

        const subscriptionDoc = {
          prevId: reload.id,
          assignmentRef: assignmentRef,
          thresholdMinimum: reload.minHours,
          reloadAmount: reload.hours,
          stripeCustomerId: accountDoc.stripeCustomerId,
          stripePaymentMethodId: reload.paymentMethodId,
          status: getSubscriptionStatus(reload.isDeleted, reload.isActive),
          createdBy: adminRef,
          created: Timestamp.now(),
          updatedBy: adminRef,
          updated: Timestamp.now()
        }

        const thresholdSubscriptionRef = db
          .collection('subscriptions')
          .doc(reload.docId)

        await thresholdSubscriptionRef.set(subscriptionDoc)
        console.log(`Threshold subscription created with id ${reload.docId}`)

        assignmentDoc.thresholdSubscriptionRef = thresholdSubscriptionRef
      }

      if (assignment.hasSub) {
        const subscription = subscriptions.find(
          (subscription) => subscription.assignmentId === assignment.id
        )

        const subscriptionStatus = getSubscriptionStatus(
          subscription.isDeleted,
          subscription.isActive
        )

        const subscriptionDoc = {
          prevId: subscription.id,
          assignmentRef: assignmentRef,
          reloadAmount: subscription.hours,
          reloadIntervalType: 'monthly',
          stripeCustomerId: accountDoc.stripeCustomerId,
          stripePaymentMethodId: subscription.paymentMethodId,
          status: subscriptionStatus,
          createdBy: adminRef,
          created: Timestamp.now(),
          updatedBy: adminRef,
          updated: Timestamp.now()
        }

        if (subscriptionStatus === 'Active') {
          subscriptionDoc.nextReload = getNextLoad()
        }

        const monthlySubscriptionRef = db
          .collection('subscriptions')
          .doc(subscription.docId)

        await monthlySubscriptionRef.set(subscriptionDoc)
        console.log(
          `Monthly subscription created with id ${subscription.docId}`
        )

        assignmentDoc.monthlySubscriptionRef = monthlySubscriptionRef
      }

      await assignmentRef.set(assignmentDoc)
      console.log(`Assignment created with id ${assignment.docId}`)
    }

    if (client.stripeCustomerId) {
      accountDoc.stripePaymentMethods = await getAllPaymentMethods(
        client.stripeCustomerId
      )
    } else {
      accountDoc.stripeCustomerId = await createStripeCustomer(
        accountDoc.billingEmail
      )
      accountDoc.stripePaymentMethods = []
    }

    await accountRef.set(accountDoc)
    console.log(`Account created with id ${accountRef.id}`)

    await delay()
  }

  return console.log('complete')
}

runMigration()
