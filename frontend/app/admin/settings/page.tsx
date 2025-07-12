"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Settings, Shield, Mail, Database, Key, AlertTriangle, Save, RefreshCw, Download, Upload } from "lucide-react"

export default function AdminSettings() {
  const [settings, setSettings] = useState({
    siteName: "AI Exam Evaluator",
    siteDescription: "Advanced AI-powered examination and evaluation platform",
    maintenanceMode: false,
    registrationEnabled: true,
    emailNotifications: true,
    autoBackup: true,
    maxFileSize: "10",
    sessionTimeout: "30",
    defaultLanguage: "en",
    timezone: "UTC",
  })

  const handleSettingChange = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
          <p className="text-muted-foreground">Configure system-wide settings and preferences</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button size="sm">
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="ai">AI Models</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                General Settings
              </CardTitle>
              <CardDescription>Basic site configuration and preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="siteName">Site Name</Label>
                  <Input
                    id="siteName"
                    value={settings.siteName}
                    onChange={(e) => handleSettingChange("siteName", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultLanguage">Default Language</Label>
                  <Select
                    value={settings.defaultLanguage}
                    onValueChange={(value) => handleSettingChange("defaultLanguage", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                      <SelectItem value="fr">French</SelectItem>
                      <SelectItem value="de">German</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteDescription">Site Description</Label>
                <Textarea
                  id="siteDescription"
                  value={settings.siteDescription}
                  onChange={(e) => handleSettingChange("siteDescription", e.target.value)}
                  rows={3}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select value={settings.timezone} onValueChange={(value) => handleSettingChange("timezone", value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="EST">Eastern Time</SelectItem>
                      <SelectItem value="PST">Pacific Time</SelectItem>
                      <SelectItem value="GMT">Greenwich Mean Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxFileSize">Max File Size (MB)</Label>
                  <Input
                    id="maxFileSize"
                    type="number"
                    value={settings.maxFileSize}
                    onChange={(e) => handleSettingChange("maxFileSize", e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Maintenance Mode</Label>
                    <p className="text-sm text-muted-foreground">Enable maintenance mode to prevent user access</p>
                  </div>
                  <Switch
                    checked={settings.maintenanceMode}
                    onCheckedChange={(checked) => handleSettingChange("maintenanceMode", checked)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>User Registration</Label>
                    <p className="text-sm text-muted-foreground">Allow new users to register accounts</p>
                  </div>
                  <Switch
                    checked={settings.registrationEnabled}
                    onCheckedChange={(checked) => handleSettingChange("registrationEnabled", checked)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security Settings
              </CardTitle>
              <CardDescription>Configure security and authentication settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="sessionTimeout">Session Timeout (minutes)</Label>
                <Input
                  id="sessionTimeout"
                  type="number"
                  value={settings.sessionTimeout}
                  onChange={(e) => handleSettingChange("sessionTimeout", e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Users will be automatically logged out after this period of inactivity
                </p>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Password Requirements</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="minPasswordLength">Minimum Length</Label>
                    <Input id="minPasswordLength" type="number" defaultValue="8" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="passwordComplexity">Complexity Requirements</Label>
                    <Select defaultValue="medium">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Two-Factor Authentication</h3>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Require 2FA for Admins</Label>
                    <p className="text-sm text-muted-foreground">Force two-factor authentication for admin accounts</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Configuration
              </CardTitle>
              <CardDescription>Configure email server and notification settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="smtpHost">SMTP Host</Label>
                  <Input id="smtpHost" placeholder="smtp.gmail.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtpPort">SMTP Port</Label>
                  <Input id="smtpPort" type="number" placeholder="587" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="smtpUsername">Username</Label>
                  <Input id="smtpUsername" type="email" placeholder="your-email@gmail.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtpPassword">Password</Label>
                  <Input id="smtpPassword" type="password" placeholder="••••••••" />
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Notification Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Email Notifications</Label>
                      <p className="text-sm text-muted-foreground">Send email notifications for important events</p>
                    </div>
                    <Switch
                      checked={settings.emailNotifications}
                      onCheckedChange={(checked) => handleSettingChange("emailNotifications", checked)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Exam Completion Notifications</Label>
                      <p className="text-sm text-muted-foreground">Notify instructors when students complete exams</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>System Alert Notifications</Label>
                      <p className="text-sm text-muted-foreground">Send alerts for system issues and maintenance</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                AI Model Configuration
              </CardTitle>
              <CardDescription>Configure AI models and API keys for exam evaluation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openaiKey">OpenAI API Key</Label>
                  <Input id="openaiKey" type="password" placeholder="sk-..." />
                  <p className="text-sm text-muted-foreground">
                    Required for AI-powered exam evaluation and question generation
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="defaultModel">Default AI Model</Label>
                  <Select defaultValue="gpt-4">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                      <SelectItem value="gpt-4">GPT-4</SelectItem>
                      <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Evaluation Settings</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="maxTokens">Max Tokens per Evaluation</Label>
                    <Input id="maxTokens" type="number" defaultValue="1000" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="temperature">AI Temperature</Label>
                    <Input id="temperature" type="number" step="0.1" min="0" max="2" defaultValue="0.7" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backup" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Backup & Recovery
              </CardTitle>
              <CardDescription>Configure automatic backups and data recovery options</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Automatic Backups</Label>
                  <p className="text-sm text-muted-foreground">Enable automatic daily backups of the database</p>
                </div>
                <Switch
                  checked={settings.autoBackup}
                  onCheckedChange={(checked) => handleSettingChange("autoBackup", checked)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="backupFrequency">Backup Frequency</Label>
                <Select defaultValue="daily">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="retentionPeriod">Retention Period (days)</Label>
                <Input id="retentionPeriod" type="number" defaultValue="30" />
                <p className="text-sm text-muted-foreground">How long to keep backup files before automatic deletion</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">
                  <Download className="h-4 w-4 mr-2" />
                  Create Backup Now
                </Button>
                <Button variant="outline">
                  <Upload className="h-4 w-4 mr-2" />
                  Restore from Backup
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Advanced Settings
              </CardTitle>
              <CardDescription>Advanced configuration options - use with caution</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Cache Management</h3>
                <div className="flex gap-2">
                  <Button variant="outline">Clear Application Cache</Button>
                  <Button variant="outline">Clear Database Cache</Button>
                  <Button variant="outline">Clear File Cache</Button>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">System Maintenance</h3>
                <div className="flex gap-2">
                  <Button variant="outline">Optimize Database</Button>
                  <Button variant="outline">Clean Temporary Files</Button>
                  <Button variant="outline">Update Search Index</Button>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-red-600">Danger Zone</h3>
                <div className="border border-red-200 rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-red-600">Reset All Settings</Label>
                      <p className="text-sm text-muted-foreground">
                        This will reset all settings to their default values
                      </p>
                    </div>
                    <Button variant="destructive" size="sm">
                      Reset
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-red-600">Clear All Data</Label>
                      <p className="text-sm text-muted-foreground">
                        This will permanently delete all user data and exams
                      </p>
                    </div>
                    <Button variant="destructive" size="sm">
                      Clear Data
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
