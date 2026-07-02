import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, School, Users, BookOpen, GraduationCap,
  ClipboardList, Settings, LogOut, Menu, X, ChevronDown,
  Wifi, WifiOff, AlertCircle, Bell
} from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useNetwork } from '@/contexts/NetworkContext'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

interface NavItem {
  label: string
  to: string
  icon: React.ElementType
  badge?: number
}

const SUPER_ADMIN_NAV: NavItem[] = [
  { label: 'Dashboard',   to: '/super-admin',         icon: LayoutDashboard },
  { label: 'Schools',     to: '/super-admin/schools', icon: School },
  { label: 'Users',       to: '/super-admin/users',   icon: Users },
  { label: 'Audit Logs',  to: '/super-admin/audit',   icon: ClipboardList },
  { label: 'Settings',    to: '/super-admin/settings',icon: Settings }
]

const SCHOOL_ADMIN_NAV: NavItem[] = [
  { label: 'Dashboard',    to: '/school',              icon: LayoutDashboard },
  { label: 'Sessions',     to: '/school/sessions',     icon: BookOpen },
  { label: 'Classes',      to: '/school/classes',      icon: GraduationCap },
  { label: 'Students',     to: '/school/students',     icon: Users },
  { label: 'Subjects',     to: '/school/subjects',     icon: BookOpen },
  { label: 'Teachers',     to: '/school/teachers',     icon: Users },
  { label: 'Assessments',  to: '/school/assessments',  icon: ClipboardList },
  { label: 'Grading',      to: '/school/grading',      icon: ClipboardList },
  { label: 'Reports',      to: '/school/reports',      icon: ClipboardList },
  { label: 'Settings',     to: '/school/settings',     icon: Settings }
]

const TEACHER_NAV: NavItem[] = [
  { label: 'Dashboard',  to: '/teacher',            icon: LayoutDashboard },
  { label: 'My Classes', to: '/teacher/classes',    icon: GraduationCap },
  { label: 'Score Entry',to: '/teacher/scores',     icon: ClipboardList },
  { label: 'Broadsheet', to: '/teacher/broadsheet', icon: BookOpen }
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, role, signOut } = useAuth()
  const { isOnline, pendingSyncCount } = useNetwork()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const nav =
    role === 'super_admin' ? SUPER_ADMIN_NAV :
    role === 'school_admin' ? SCHOOL_ADMIN_NAV :
    TEACHER_NAV

  const handleSignOut = async () => {
    await signOut()
    navigate('/auth/login')
  }

  const roleBadgeLabel = role === 'super_admin' ? 'Super Admin' : role === 'school_admin' ? 'Admin' : 'Teacher'

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-brand-900 text-white transition-transform duration-300 lg:static lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-brand-800">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm">
              CA
            </div>
            <span className="font-bold text-lg tracking-tight">CA-Wizard</span>
          </div>
          <button className="lg:hidden text-white/70 hover:text-white" onClick={() => setSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/super-admin' || item.to === '/school' || item.to === '/teacher'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-700 text-white'
                  : 'text-brand-100 hover:bg-brand-800 hover:text-white'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              {item.badge ? (
                <Badge variant="destructive" className="ml-auto text-xs h-5 px-1.5">
                  {item.badge}
                </Badge>
              ) : null}
            </NavLink>
          ))}
        </nav>

        {/* Sync status */}
        {pendingSyncCount > 0 && (
          <div className="mx-3 mb-2 rounded-md bg-yellow-500/20 border border-yellow-500/30 px-3 py-2">
            <div className="flex items-center gap-2 text-yellow-300 text-xs">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{pendingSyncCount} score{pendingSyncCount !== 1 ? 's' : ''} pending sync</span>
            </div>
          </div>
        )}

        {/* Profile footer */}
        <div className="border-t border-brand-800 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-brand-800 transition-colors">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={profile?.avatar_url ?? ''} />
                  <AvatarFallback className="bg-brand-700 text-white text-xs">
                    {profile ? initials(profile.first_name, profile.last_name) : 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">
                    {profile?.first_name} {profile?.last_name}
                  </p>
                  <p className="text-xs text-brand-300 truncate">{roleBadgeLabel}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-brand-400 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-48">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="hidden lg:block" />

          <div className="flex items-center gap-3">
            {/* Online indicator */}
            <div className={cn(
              'flex items-center gap-1.5 text-xs px-2 py-1 rounded-full',
              isOnline
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            )}>
              {isOnline
                ? <Wifi className="h-3 w-3" />
                : <WifiOff className="h-3 w-3" />
              }
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>

            <Button variant="ghost" size="icon">
              <Bell className="h-5 w-5" />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  )
}
