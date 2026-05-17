import { ChevronDown, ChevronRight, Maximize2, Minimize2, Search, Users2, Pencil, Briefcase } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/context/auth-context'
import { useOrganization } from '@/features/organization/context/organization-context'
import { notify } from '@/lib/notify'
import { supabase } from '@/lib/supabase'
import type { OrgChartNode, OrgChartProfile, VacantRole, UpdateHierarchyResponse } from '@/types/org-chart'

export function OrgChartPage() {
  const { currentUser } = useAuth()
  const { currentOrganization } = useOrganization()
  const [profiles, setProfiles] = useState<OrgChartProfile[]>([])
  const [vacantRoles, setVacantRoles] = useState<VacantRole[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [openRolesPanelOpen, setOpenRolesPanelOpen] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null)
  const [savingHierarchy, setSavingHierarchy] = useState(false)
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const isAdmin = useMemo(
    () => ['admin', 'owner'].includes((currentUser?.roleLabel ?? '').toLowerCase()),
    [currentUser?.roleLabel]
  )

  const isMobile = useMemo(() => window.innerWidth < 768, [])

  // Load profiles and vacant roles
  const loadData = useCallback(async () => {
    try {
      const [profilesResult, vacantRolesResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, job_title, department, manager_id, org_chart_sort_order, job_id')
          .eq('organization_id', currentOrganization.id)
          .order('org_chart_sort_order', { ascending: true }),
        supabase.rpc('get_vacant_roles', { p_organization_id: currentOrganization.id })
      ])

      if (profilesResult.error) throw profilesResult.error
      if (vacantRolesResult.error) throw vacantRolesResult.error

      setProfiles(profilesResult.data as OrgChartProfile[])
      setVacantRoles(vacantRolesResult.data as VacantRole[])
    } catch (error) {
      console.error('Failed to load org chart data:', error)
      notify.error('Failed to load organization chart', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setLoading(false)
    }
  }, [currentOrganization.id])

  useEffect(() => {
    void loadData()

    // Subscribe to real-time updates
    const channel = supabase
      .channel('org-chart-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        void loadData()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        void loadData()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadData])

  // Build tree structure from flat profiles list
  const tree = useMemo(() => {
    const profileMap = new Map<string, OrgChartNode>(
      profiles.map(p => [p.id, { ...p, children: [], isExpanded: true, descendantCount: 0 }])
    )
    const roots: OrgChartNode[] = []

    // Build parent-child relationships
    for (const profile of profiles) {
      const node = profileMap.get(profile.id)
      if (!node) continue

      if (profile.manager_id) {
        const parent = profileMap.get(profile.manager_id)
        if (parent) {
          parent.children.push(node)
        } else {
          // Manager not found, treat as root
          roots.push(node)
        }
      } else {
        roots.push(node)
      }
    }

    // Sort children by sort_order
    const sortChildren = (node: OrgChartNode) => {
      node.children.sort((a, b) => a.org_chart_sort_order - b.org_chart_sort_order)
      node.children.forEach(sortChildren)
    }

    roots.forEach(sortChildren)
    roots.sort((a, b) => a.org_chart_sort_order - b.org_chart_sort_order)

    // Calculate descendant counts
    const calculateDescendants = (node: OrgChartNode): number => {
      node.descendantCount = node.children.reduce((sum, child) => sum + 1 + calculateDescendants(child), 0)
      return node.descendantCount
    }

    roots.forEach(calculateDescendants)

    return roots
  }, [profiles])

  // Filter tree by search query
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return tree

    const query = searchQuery.toLowerCase()
    const matchingIds = new Set<string>()

    // Find all matching nodes
    for (const profile of profiles) {
      const fullName = profile.full_name?.toLowerCase() ?? ''
      const jobTitle = profile.job_title?.toLowerCase() ?? ''
      const department = profile.department?.toLowerCase() ?? ''

      if (fullName.includes(query) || jobTitle.includes(query) || department.includes(query)) {
        matchingIds.add(profile.id)

        // Add all ancestors to show path
        let currentId = profile.manager_id
        while (currentId) {
          matchingIds.add(currentId)
          const parent = profiles.find(p => p.id === currentId)
          currentId = parent?.manager_id ?? null
        }
      }
    }

    // Filter tree to only matching nodes
    const filterNode = (node: OrgChartNode): OrgChartNode | null => {
      if (!matchingIds.has(node.id)) return null

      return {
        ...node,
        children: node.children.map(filterNode).filter((n): n is OrgChartNode => n !== null),
        isExpanded: true
      }
    }

    return tree.map(filterNode).filter((n): n is OrgChartNode => n !== null)
  }, [tree, searchQuery, profiles])

  // Toggle node expansion
  const toggleNode = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  // Expand all nodes
  const expandAll = useCallback(() => {
    setExpandedNodes(new Set(profiles.map(p => p.id)))
  }, [profiles])

  // Collapse all nodes
  const collapseAll = useCallback(() => {
    setExpandedNodes(new Set())
  }, [])

  // Update hierarchy
  const updateHierarchy = useCallback(async (profileId: string, newManagerId: string | null, newSortOrder: number) => {
    setSavingHierarchy(true)
    try {
      const { data, error } = await supabase.rpc('update_profile_hierarchy', {
        p_profile_id: profileId,
        p_new_manager_id: newManagerId,
        p_new_sort_order: newSortOrder
      })

      if (error) throw error

      const response = data as UpdateHierarchyResponse
      if (!response.success) {
        throw new Error(response.error ?? 'Failed to update hierarchy')
      }

      notify.success('Hierarchy updated')
      await loadData()
    } catch (error) {
      console.error('Failed to update hierarchy:', error)
      notify.error('Failed to update hierarchy', {
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setSavingHierarchy(false)
    }
  }, [loadData])

  // Handle manager assignment
  const handleAssignManager = useCallback(async () => {
    if (!editingProfileId) return

    const profile = profiles.find(p => p.id === editingProfileId)
    if (!profile) return

    await updateHierarchy(editingProfileId, selectedManagerId, profile.org_chart_sort_order)
    setEditingProfileId(null)
    setSelectedManagerId(null)
  }, [editingProfileId, selectedManagerId, profiles, updateHierarchy])

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, nodeId: string) => {
    if (!isAdmin) return
    setDraggedNodeId(nodeId)
    e.dataTransfer.effectAllowed = 'move'
  }, [isAdmin])

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    if (!isAdmin || !draggedNodeId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetId(targetId)
  }, [isAdmin, draggedNodeId])

  const handleDragLeave = useCallback(() => {
    setDropTargetId(null)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!isAdmin || !draggedNodeId || draggedNodeId === targetId) {
      setDraggedNodeId(null)
      setDropTargetId(null)
      return
    }

    const draggedProfile = profiles.find(p => p.id === draggedNodeId)
    if (!draggedProfile) return

    // Set target as new manager
    await updateHierarchy(draggedNodeId, targetId, 0)

    setDraggedNodeId(null)
    setDropTargetId(null)
  }, [isAdmin, draggedNodeId, profiles, updateHierarchy])

  // Render a single node
  const renderNode = useCallback((node: OrgChartNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedNodes.has(node.id) || searchQuery.trim().length > 0
    const hasChildren = node.children.length > 0
    const isHighlighted = searchQuery.trim().length > 0 && (
      node.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.job_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.department?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    const isDragTarget = dropTargetId === node.id
    const isDragging = draggedNodeId === node.id

    return (
      <div key={node.id} className="relative">
        <Card
          className={`mb-2 transition-all ${isHighlighted ? 'ring-2 ring-primary' : ''} ${isDragTarget ? 'ring-2 ring-blue-500' : ''} ${isDragging ? 'opacity-50' : ''}`}
          draggable={isAdmin && !isMobile}
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.id)}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              {hasChildren && (
                <button
                  onClick={() => toggleNode(node.id)}
                  className="flex-shrink-0 hover:bg-muted rounded p-1"
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              )}
              <Avatar className="h-12 w-12 flex-shrink-0">
                <AvatarImage src={node.avatar_url ?? undefined} alt={node.full_name ?? ''} />
                <AvatarFallback>
                  {node.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() ?? '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{node.full_name ?? 'Unknown'}</div>
                <div className="text-sm text-muted-foreground truncate">{node.job_title ?? 'No title'}</div>
                {node.department && (
                  <div className="text-xs text-muted-foreground truncate">{node.department}</div>
                )}
              </div>
              {hasChildren && !isExpanded && (
                <Badge variant="secondary" className="flex-shrink-0">
                  {node.descendantCount}
                </Badge>
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditingProfileId(node.id)
                    setSelectedManagerId(node.manager_id)
                  }}
                  className="flex-shrink-0"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        {hasChildren && isExpanded && (
          <div className="ml-8 border-l-2 border-muted pl-4">
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }, [expandedNodes, searchQuery, dropTargetId, draggedNodeId, isAdmin, isMobile, toggleNode, handleDragStart, handleDragOver, handleDragLeave, handleDrop])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading organization chart...</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b">
        <div>
          <h1 className="text-2xl font-bold">Organization Chart</h1>
          <p className="text-sm text-muted-foreground">Visual reporting hierarchy</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpenRolesPanelOpen(true)}
          >
            <Users2 className="h-4 w-4 mr-2" />
            Open Roles ({vacantRoles.length})
          </Button>
          <Button variant="outline" size="sm" onClick={expandAll}>
            <Maximize2 className="h-4 w-4 mr-2" />
            Expand All
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            <Minimize2 className="h-4 w-4 mr-2" />
            Collapse All
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="p-6 border-b">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search people..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto p-6">
        {filteredTree.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            {searchQuery.trim() ? 'No matching people found' : 'No organization structure defined'}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            {filteredTree.map(node => renderNode(node))}
          </div>
        )}
      </div>

      {/* Edit Manager Dialog */}
      <Dialog open={editingProfileId !== null} onOpenChange={(open) => !open && setEditingProfileId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Manager</DialogTitle>
            <DialogDescription>
              Select a new manager for {profiles.find(p => p.id === editingProfileId)?.full_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Manager</label>
              <select
                value={selectedManagerId ?? ''}
                onChange={(e) => setSelectedManagerId(e.target.value || null)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2"
              >
                <option value="">No manager (root)</option>
                {profiles
                  .filter(p => p.id !== editingProfileId)
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} {p.job_title ? `- ${p.job_title}` : ''}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProfileId(null)}>
              Cancel
            </Button>
            <Button onClick={handleAssignManager} disabled={savingHierarchy}>
              {savingHierarchy ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Open Roles Panel */}
      <Dialog open={openRolesPanelOpen} onOpenChange={setOpenRolesPanelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open Roles</DialogTitle>
            <DialogDescription>
              {vacantRoles.length === 0 ? 'No open positions' : `${vacantRoles.length} open position${vacantRoles.length === 1 ? '' : 's'}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-auto">
            {vacantRoles.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                All positions are currently filled
              </div>
            ) : (
              vacantRoles.map(role => (
                <Card key={role.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Briefcase className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{role.name}</div>
                        <div className="text-sm text-muted-foreground">{role.department_name}</div>
                        {role.description && (
                          <div className="text-xs text-muted-foreground mt-1">{role.description}</div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
