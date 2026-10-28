import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Shield,
  Users,
  Settings,
  FileText,
  Bell,
  History,
  Download,
  Flag,
  Menu,
  Lock,
  BookOpen,
  GraduationCap,
  ArrowLeftRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { api, getApiError } from '@/lib/api';

interface Permission {
  id: string;
  resource: string;
  action: string;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
}

interface PermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role | null;
}

// Define available resources and their metadata
const RESOURCES_CONFIG = [
  {
    id: 'users',
    label: 'Users',
    description: 'User management',
    icon: Users,
  },
  {
    id: 'roles',
    label: 'Roles',
    description: 'Role management',
    icon: Shield,
  },
  {
    id: 'permissions',
    label: 'Permissions',
    description: 'Permission management',
    icon: Lock,
  },
  {
    id: 'menu',
    label: 'Menu',
    description: 'Navigation menu configuration',
    icon: Menu,
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Application settings',
    icon: Settings,
  },
  {
    id: 'files',
    label: 'Files',
    description: 'File uploads and management',
    icon: FileText,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Notification management',
    icon: Bell,
  },
  {
    id: 'audit-logs',
    label: 'Audit Logs',
    description: 'Audit trail and logs',
    icon: History,
  },
  {
    id: 'exports',
    label: 'Exports',
    description: 'Data export functionality',
    icon: Download,
  },
  {
    id: 'feature-flags',
    label: 'Feature Flags',
    description: 'Feature flag management',
    icon: Flag,
  },
  { id: 'books', label: 'Books', description: 'Books list', icon: BookOpen },
  { id: 'students', label: 'Students', description: 'Students list', icon: GraduationCap },
  { id: 'issues', label: 'Issue', description: 'Issues list', icon: ArrowLeftRight },
] as const;

const ACTIONS = [
  { id: 'view', label: 'View' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
] as const;

type PermissionKey = `${string}:${string}`;

export function PermissionsDialog({ open, onOpenChange, role }: PermissionsDialogProps) {
  const queryClient = useQueryClient();
  const [selectedPermissions, setSelectedPermissions] = useState<Set<PermissionKey>>(new Set());

  // Initialize selected permissions when role changes
  useEffect(() => {
    if (role) {
      const perms = new Set<PermissionKey>(
        role.permissions.map((p) => `${p.resource}:${p.action}` as PermissionKey)
      );
      setSelectedPermissions(perms);
    } else {
      setSelectedPermissions(new Set());
    }
  }, [role]);

  const mutation = useMutation({
    mutationFn: async (permissions: { resource: string; action: string }[]) => {
      const response = await api.put(`/roles/${role?.id}/permissions`, { permissions });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Permissions updated successfully');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  const handleTogglePermission = (resource: string, action: string) => {
    const key = `${resource}:${action}` as PermissionKey;
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleToggleAllForResource = (resource: string) => {
    const resourcePermissions = ACTIONS.map((a) => `${resource}:${a.id}` as PermissionKey);
    const allSelected = resourcePermissions.every((p) => selectedPermissions.has(p));

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        resourcePermissions.forEach((p) => next.delete(p));
      } else {
        resourcePermissions.forEach((p) => next.add(p));
      }
      return next;
    });
  };

  const handleToggleAllForAction = (action: string) => {
    const actionPermissions = RESOURCES_CONFIG.map((r) => `${r.id}:${action}` as PermissionKey);
    const allSelected = actionPermissions.every((p) => selectedPermissions.has(p));

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        actionPermissions.forEach((p) => next.delete(p));
      } else {
        actionPermissions.forEach((p) => next.add(p));
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const allPermissions: PermissionKey[] = [];
    RESOURCES_CONFIG.forEach((r) => {
      ACTIONS.forEach((a) => {
        allPermissions.push(`${r.id}:${a.id}` as PermissionKey);
      });
    });
    setSelectedPermissions(new Set(allPermissions));
  };

  const handleClearAll = () => {
    setSelectedPermissions(new Set());
  };

  const handleSave = () => {
    const permissions = Array.from(selectedPermissions).map((key) => {
      const [resource, action] = key.split(':');
      return { resource, action };
    });
    mutation.mutate(permissions);
  };

  const isResourceFullySelected = (resource: string) => {
    return ACTIONS.every((a) => selectedPermissions.has(`${resource}:${a.id}` as PermissionKey));
  };

  const isResourcePartiallySelected = (resource: string) => {
    const selected = ACTIONS.some((a) =>
      selectedPermissions.has(`${resource}:${a.id}` as PermissionKey)
    );
    const allSelected = isResourceFullySelected(resource);
    return selected && !allSelected;
  };

  if (!role) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Manage Permissions for "{role.name}"</DialogTitle>
          <DialogDescription>
            Select the permissions for this role. Users with this role will have access to the
            selected resources and actions.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2 mb-4">
          <Button variant="outline" size="sm" onClick={handleSelectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearAll}>
            Clear All
          </Button>
        </div>

        <ScrollArea className="h-[500px] pr-4">
          {/* Header Row - Action Labels */}
          <div className="grid grid-cols-[1fr_repeat(4,80px)] gap-2 mb-4 sticky top-0 bg-background pb-2 border-b">
            <div className="font-medium text-sm text-muted-foreground">Resource</div>
            {ACTIONS.map((action) => (
              <div key={action.id} className="text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs font-medium text-muted-foreground h-auto py-1"
                  onClick={() => handleToggleAllForAction(action.id)}
                  title={`Toggle all ${action.label}`}
                >
                  {action.label}
                </Button>
              </div>
            ))}
          </div>

          {/* Permission Rows */}
          <div className="space-y-4">
            {RESOURCES_CONFIG.map((resource) => {
              const Icon = resource.icon;
              const isAllSelected = isResourceFullySelected(resource.id);
              const isPartial = isResourcePartiallySelected(resource.id);

              return (
                <div key={resource.id}>
                  <div className="grid grid-cols-[1fr_repeat(4,80px)] gap-2 items-center py-2 hover:bg-muted/50 rounded-lg px-2">
                    {/* Resource Info */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isAllSelected}
                          // @ts-expect-error - indeterminate is a valid prop
                          indeterminate={isPartial}
                          onCheckedChange={() => handleToggleAllForResource(resource.id)}
                          id={`resource-${resource.id}`}
                        />
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <Label
                          htmlFor={`resource-${resource.id}`}
                          className="font-medium cursor-pointer"
                        >
                          {resource.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{resource.description}</p>
                      </div>
                    </div>

                    {/* Permission Checkboxes */}
                    {ACTIONS.map((action) => {
                      const permKey = `${resource.id}:${action.id}` as PermissionKey;
                      const isChecked = selectedPermissions.has(permKey);

                      return (
                        <div key={action.id} className="flex justify-center">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => handleTogglePermission(resource.id, action.id)}
                            id={permKey}
                            aria-label={`${resource.label} - ${action.label}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <Separator className="mt-2" />
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {selectedPermissions.size} permission{selectedPermissions.size !== 1 ? 's' : ''}{' '}
            selected
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Permissions'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
