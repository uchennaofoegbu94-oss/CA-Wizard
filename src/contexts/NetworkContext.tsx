import React, { createContext, useContext, useEffect, useState } from 'react'
import { getPendingScoreCount } from '@/lib/idb'

interface NetworkContextValue {
  isOnline: boolean
  pendingSyncCount: number
  checkPending: () => Promise<void>
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: navigator.onLine,
  pendingSyncCount: 0,
  checkPending: async () => {}
})

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingSyncCount, setPendingSyncCount] = useState(0)

  const checkPending = async () => {
    const count = await getPendingScoreCount()
    setPendingSyncCount(count)
  }

  useEffect(() => {
    const online = () => {
      setIsOnline(true)
      checkPending()
    }
    const offline = () => setIsOnline(false)

    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    checkPending()

    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  return (
    <NetworkContext.Provider value={{ isOnline, pendingSyncCount, checkPending }}>
      {children}
    </NetworkContext.Provider>
  )
}

export const useNetwork = () => useContext(NetworkContext)
