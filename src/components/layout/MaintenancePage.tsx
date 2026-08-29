import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'

export function MaintenancePage({ message }: { message: string | null }) {
  const { signOut } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md text-center">
        <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-xl font-bold mb-2">CA-Wizard is under maintenance</h1>
        <p className="text-muted-foreground mb-6">
          {message || "We're making some improvements and will be back shortly. Thanks for your patience."}
        </p>
        <Button variant="outline" onClick={() => signOut()}>Sign Out</Button>
      </div>
    </div>
  )
}
