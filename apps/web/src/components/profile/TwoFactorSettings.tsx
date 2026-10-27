import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, Key, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api, getApiError } from '@/lib/api';
import { useCurrentUser } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';

interface Setup2FAResponse {
  secret: string;
  otpauth: string;
}

interface Verify2FAResponse {
  success: boolean;
  backupCodes?: string[];
}

interface BackupCodesStatusResponse {
  enabled: boolean;
  remaining: number;
  total: number;
}

export function TwoFactorSettings() {
  const { user } = useCurrentUser();
  const { setUser } = useAuthStore();
  const queryClient = useQueryClient();

  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [showBackupCodesDialog, setShowBackupCodesDialog] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);

  const [setupData, setSetupData] = useState<Setup2FAResponse | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Fetch backup codes status
  const { data: backupCodesStatus, refetch: refetchBackupCodesStatus } = useQuery({
    queryKey: ['backup-codes-status'],
    queryFn: async () => {
      const response = await api.get('/auth/2fa/backup-codes/status');
      return response.data.data as BackupCodesStatusResponse;
    },
    enabled: !!user?.twoFactorEnabled,
  });

  // Setup 2FA mutation
  const setupMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/auth/2fa/setup');
      return response.data.data as Setup2FAResponse;
    },
    onSuccess: async (data) => {
      setSetupData(data);
      const qrUrl = await QRCode.toDataURL(data.otpauth);
      setQrCodeUrl(qrUrl);
      setShowSetupDialog(true);
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  // Verify 2FA mutation
  const verifyMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await api.post('/auth/2fa/verify', { code });
      return response.data.data as Verify2FAResponse;
    },
    onSuccess: (data) => {
      if (data.backupCodes) {
        setBackupCodes(data.backupCodes);
        setShowSetupDialog(false);
        setShowBackupCodesDialog(true);
      }
      // Update user state
      if (user) {
        setUser({ ...user, twoFactorEnabled: true });
      }
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      refetchBackupCodesStatus();
      toast.success('Two-factor authentication enabled');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  // Disable 2FA mutation
  const disableMutation = useMutation({
    mutationFn: async (password: string) => {
      const response = await api.delete('/auth/2fa/disable', {
        data: { password },
      });
      return response.data.data;
    },
    onSuccess: () => {
      setShowDisableDialog(false);
      setPassword('');
      // Update user state
      if (user) {
        setUser({ ...user, twoFactorEnabled: false });
      }
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      queryClient.invalidateQueries({ queryKey: ['backup-codes-status'] });
      toast.success('Two-factor authentication disabled');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  // Regenerate backup codes mutation
  const regenerateMutation = useMutation({
    mutationFn: async (password: string) => {
      const response = await api.post('/auth/2fa/backup-codes/regenerate', { password });
      return response.data.data as { backupCodes: string[] };
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setShowRegenerateDialog(false);
      setShowBackupCodesDialog(true);
      setPassword('');
      refetchBackupCodesStatus();
      toast.success('Backup codes regenerated');
    },
    onError: (error) => {
      toast.error(getApiError(error).message);
    },
  });

  const handleSetup = () => {
    setupMutation.mutate();
  };

  const handleVerify = () => {
    if (verificationCode.length === 6) {
      verifyMutation.mutate(verificationCode);
    }
  };

  const handleDisable = () => {
    if (password) {
      disableMutation.mutate(password);
    }
  };

  const handleRegenerate = () => {
    if (password) {
      regenerateMutation.mutate(password);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const copyAllCodes = () => {
    const codesText = backupCodes.join('\n');
    navigator.clipboard.writeText(codesText);
    toast.success('All backup codes copied to clipboard');
  };

  const downloadCodes = () => {
    const codesText = `Admin Panel - Two-Factor Authentication Backup Codes\n\nKeep these codes safe. Each code can only be used once.\n\n${backupCodes.join('\n')}\n\nGenerated: ${new Date().toISOString()}`;
    const blob = new Blob([codesText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const is2FAEnabled = user?.twoFactorEnabled;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Two-Factor Authentication
            </CardTitle>
            <CardDescription>
              Add an extra layer of security to your account
            </CardDescription>
          </div>
          <Badge variant={is2FAEnabled ? 'default' : 'secondary'}>
            {is2FAEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {is2FAEnabled ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your account is protected with two-factor authentication using an authenticator app.
            </p>

            {backupCodesStatus && (
              <Alert variant={backupCodesStatus.remaining <= 2 ? 'destructive' : 'default'}>
                <Key className="h-4 w-4" />
                <AlertTitle>Backup Codes</AlertTitle>
                <AlertDescription>
                  You have {backupCodesStatus.remaining} of {backupCodesStatus.total} backup codes remaining.
                  {backupCodesStatus.remaining <= 2 && (
                    <span className="block mt-1 font-medium">
                      Consider regenerating your backup codes.
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowRegenerateDialog(true)}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate Backup Codes
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowDisableDialog(true)}
              >
                Disable 2FA
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Protect your account by requiring a verification code from an authenticator app
              when you sign in.
            </p>
            <Button onClick={handleSetup} loading={setupMutation.isPending}>
              <Shield className="h-4 w-4 mr-2" />
              Enable Two-Factor Authentication
            </Button>
          </>
        )}

        {/* Setup Dialog */}
        <Dialog open={showSetupDialog} onOpenChange={setShowSetupDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
              <DialogDescription>
                Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {qrCodeUrl && (
                <div className="flex justify-center">
                  <img src={qrCodeUrl} alt="QR Code" className="rounded-lg" />
                </div>
              )}

              {setupData && (
                <div className="space-y-2">
                  <Label>Manual entry code</Label>
                  <div className="flex gap-2">
                    <Input value={setupData.secret} readOnly className="font-mono text-sm" />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(setupData.secret)}
                    >
                      {copiedCode === setupData.secret ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Enter verification code</Label>
                <Input
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="text-center text-2xl font-mono tracking-widest"
                  maxLength={6}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSetupDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleVerify}
                disabled={verificationCode.length !== 6}
                loading={verifyMutation.isPending}
              >
                Verify & Enable
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Disable Dialog */}
        <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
              <DialogDescription>
                This will remove the extra security from your account. Enter your password to confirm.
              </DialogDescription>
            </DialogHeader>

            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                Disabling two-factor authentication will make your account less secure.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDisableDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisable}
                disabled={!password}
                loading={disableMutation.isPending}
              >
                Disable 2FA
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Regenerate Backup Codes Dialog */}
        <Dialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Regenerate Backup Codes</DialogTitle>
              <DialogDescription>
                This will invalidate your existing backup codes and generate new ones.
                Enter your password to confirm.
              </DialogDescription>
            </DialogHeader>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                Your current backup codes will stop working immediately.
                Make sure to save the new codes.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRegenerateDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRegenerate}
                disabled={!password}
                loading={regenerateMutation.isPending}
              >
                Regenerate Codes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Backup Codes Display Dialog */}
        <Dialog open={showBackupCodesDialog} onOpenChange={setShowBackupCodesDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Save Your Backup Codes</DialogTitle>
              <DialogDescription>
                Keep these codes in a safe place. You can use them to access your account
                if you lose your authenticator device.
              </DialogDescription>
            </DialogHeader>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                Each code can only be used once. This is the only time you'll see these codes.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
              {backupCodes.map((code, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-background rounded"
                >
                  <span>{code}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(code)}
                    className="h-6 w-6 p-0"
                  >
                    {copiedCode === code ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              ))}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={copyAllCodes} className="w-full sm:w-auto">
                <Copy className="h-4 w-4 mr-2" />
                Copy All
              </Button>
              <Button variant="outline" onClick={downloadCodes} className="w-full sm:w-auto">
                Download
              </Button>
              <Button onClick={() => setShowBackupCodesDialog(false)} className="w-full sm:w-auto">
                I've Saved These Codes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
