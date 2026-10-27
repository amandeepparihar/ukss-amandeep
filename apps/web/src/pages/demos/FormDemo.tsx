import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form } from '@/components/forms/Form';
import { TextField } from '@/components/forms/TextField';
import { TextareaField } from '@/components/forms/TextareaField';
import { SelectField } from '@/components/forms/SelectField';
import { ComboboxField, type ComboboxOption } from '@/components/forms/ComboboxField';
import { CheckboxField } from '@/components/forms/CheckboxField';
import { SwitchField } from '@/components/forms/SwitchField';
import { RadioGroupField } from '@/components/forms/RadioGroupField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useNotifications } from '@/hooks/useNotifications';
import { api } from '@/lib/api';

// Form schema
const demoFormSchema = z.object({
  // Text fields
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().optional(),

  // Textarea
  bio: z.string().max(500, 'Bio must be 500 characters or less').optional(),

  // Select
  country: z.string().min(1, 'Please select a country'),
  role: z.string().min(1, 'Please select a role'),

  // Combobox (searchable dropdown)
  assignedUser: z.string().optional(),

  // Checkbox
  agreeTerms: z.boolean().refine((val) => val === true, 'You must agree to the terms'),
  newsletter: z.boolean().optional(),

  // Switch
  notifications: z.boolean().default(true),
  darkMode: z.boolean().default(false),

  // Radio group
  plan: z.enum(['free', 'pro', 'enterprise'], { required_error: 'Please select a plan' }),
  gender: z.enum(['male', 'female', 'other', 'prefer-not-to-say']).optional(),
});

type DemoFormData = z.infer<typeof demoFormSchema>;

const countryOptions = [
  { label: 'United States', value: 'us' },
  { label: 'United Kingdom', value: 'uk' },
  { label: 'Canada', value: 'ca' },
  { label: 'Australia', value: 'au' },
  { label: 'Germany', value: 'de' },
  { label: 'France', value: 'fr' },
  { label: 'India', value: 'in' },
];

const roleOptions = [
  { label: 'Admin', value: 'admin' },
  { label: 'Editor', value: 'editor' },
  { label: 'Viewer', value: 'viewer' },
  { label: 'Guest', value: 'guest' },
];

const planOptions = [
  { label: 'Free - $0/month', value: 'free' },
  { label: 'Pro - $19/month', value: 'pro' },
  { label: 'Enterprise - $99/month', value: 'enterprise' },
];

const genderOptions = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
  { label: 'Prefer not to say', value: 'prefer-not-to-say' },
];

export function FormDemo() {
  const { success } = useNotifications();

  const form = useForm<DemoFormData>({
    resolver: zodResolver(demoFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      phone: '',
      bio: '',
      country: '',
      role: '',
      assignedUser: '',
      agreeTerms: false,
      newsletter: false,
      notifications: true,
      darkMode: false,
      plan: 'free',
    },
  });

  // Fetch users from the API for the searchable dropdown
  const fetchUsers = useCallback(async (search: string): Promise<ComboboxOption[]> => {
    try {
      const response = await api.get('/users', {
        params: {
          pageSize: 10,
          search: search || undefined,
        },
      });
      const users = response.data?.data || [];
      return users.map((user: { id: string; firstName: string; lastName: string; email: string }) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName} (${user.email})`,
      }));
    } catch (error) {
      console.error('Failed to fetch users:', error);
      return [];
    }
  }, []);

  const onSubmit = (data: DemoFormData) => {
    console.log('Form submitted:', data);
    success('Form Submitted!', {
      message: 'Check the console for form data',
      persist: true,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Form Components</h1>
        <p className="text-muted-foreground">
          Reusable form field components built with React Hook Form and Zod validation.
        </p>
      </div>

      <Tabs defaultValue="demo" className="space-y-4">
        <TabsList>
          <TabsTrigger value="demo">Demo</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="demo" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Complete Form Example</CardTitle>
              <CardDescription>
                All form field components with validation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Text Fields Section */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Text Fields</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      name="firstName"
                      label="First Name"
                      placeholder="John"
                      required
                    />
                    <TextField
                      name="lastName"
                      label="Last Name"
                      placeholder="Doe"
                      required
                    />
                    <TextField
                      name="email"
                      label="Email"
                      type="email"
                      placeholder="john@example.com"
                      description="We'll never share your email."
                      required
                    />
                    <TextField
                      name="password"
                      label="Password"
                      type="password"
                      placeholder="Enter password"
                      required
                    />
                    <TextField
                      name="phone"
                      label="Phone Number"
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>
                </div>

                <Separator />

                {/* Textarea Section */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Textarea</h3>
                  <TextareaField
                    name="bio"
                    label="Bio"
                    placeholder="Tell us about yourself..."
                    description="Maximum 500 characters"
                    rows={4}
                  />
                </div>

                <Separator />

                {/* Select Fields Section */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Select Fields</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <SelectField
                      name="country"
                      label="Country"
                      placeholder="Select a country"
                      options={countryOptions}
                      required
                    />
                    <SelectField
                      name="role"
                      label="Role"
                      placeholder="Select a role"
                      options={roleOptions}
                      required
                    />
                  </div>
                </div>

                <Separator />

                {/* Combobox (Searchable Dropdown) Section */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Searchable Dropdown (Combobox)</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    This dropdown fetches the first 10 users from the database when opened.
                    Type to search and find more users.
                  </p>
                  <div className="max-w-md">
                    <ComboboxField
                      name="assignedUser"
                      label="Assign to User"
                      placeholder="Select a user..."
                      searchPlaceholder="Search users..."
                      description="Fetches users from the database with search support"
                      fetchOptions={fetchUsers}
                      emptyMessage="No users found."
                    />
                  </div>
                </div>

                <Separator />

                {/* Checkbox Fields Section */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Checkbox Fields</h3>
                  <div className="space-y-4">
                    <CheckboxField
                      name="agreeTerms"
                      label="I agree to the terms and conditions"
                      description="You must agree before submitting"
                    />
                    <CheckboxField
                      name="newsletter"
                      label="Subscribe to newsletter"
                      description="Get updates about new features and releases"
                    />
                  </div>
                </div>

                <Separator />

                {/* Switch Fields Section */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Switch Fields</h3>
                  <div className="space-y-4">
                    <SwitchField
                      name="notifications"
                      label="Email Notifications"
                      description="Receive email notifications for important updates"
                    />
                    <SwitchField
                      name="darkMode"
                      label="Dark Mode"
                      description="Use dark theme across the application"
                    />
                  </div>
                </div>

                <Separator />

                {/* Radio Group Fields Section */}
                <div>
                  <h3 className="text-lg font-medium mb-4">Radio Group Fields</h3>
                  <div className="grid gap-6 md:grid-cols-2">
                    <RadioGroupField
                      name="plan"
                      label="Subscription Plan"
                      options={planOptions}
                      required
                    />
                    <RadioGroupField
                      name="gender"
                      label="Gender"
                      options={genderOptions}
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex justify-end gap-4">
                  <Button type="button" variant="outline" onClick={() => form.reset()}>
                    Reset
                  </Button>
                  <Button type="submit">Submit Form</Button>
                </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">TextField</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Standard text input with label, placeholder, description, and error handling.</p>
                <p className="mt-2 font-medium">Supports types: text, email, password, tel, url, number</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">TextareaField</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Multi-line text input for longer content like descriptions or comments.</p>
                <p className="mt-2 font-medium">Configurable rows and max length</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">SelectField</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Dropdown selection with searchable options and custom placeholder.</p>
                <p className="mt-2 font-medium">Built on Radix UI Select</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">CheckboxField</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Boolean input for accepting terms, toggling options, or multi-select scenarios.</p>
                <p className="mt-2 font-medium">With optional description text</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">SwitchField</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Toggle switch for on/off settings with visual feedback.</p>
                <p className="mt-2 font-medium">Ideal for settings pages</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">RadioGroupField</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Single selection from multiple options displayed as radio buttons.</p>
                <p className="mt-2 font-medium">Clear visual selection state</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Basic Form Setup</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form } from '@/components/forms/Form';
import { TextField } from '@/components/forms/TextField';

// 1. Define schema with Zod
const schema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Invalid email'),
});

// 2. Create form with react-hook-form
const form = useForm({
  resolver: zodResolver(schema),
  defaultValues: { name: '', email: '' },
});

// 3. Handle submit
const onSubmit = (data) => {
  console.log(data);
};

// 4. Render form
<Form form={form} onSubmit={onSubmit}>
  <TextField name="name" label="Name" required />
  <TextField name="email" label="Email" type="email" required />
  <Button type="submit">Submit</Button>
</Form>`}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Field Props</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`// Common props for all field components
interface FieldProps {
  name: string;          // Form field name (required)
  label?: string;        // Field label
  description?: string;  // Help text below field
  required?: boolean;    // Show required indicator
  disabled?: boolean;    // Disable the field
  placeholder?: string;  // Placeholder text
}

// TextField specific
<TextField
  name="email"
  type="email"           // text | email | password | tel | url | number
  autoComplete="email"
/>

// SelectField specific
<SelectField
  name="country"
  options={[
    { label: 'USA', value: 'us' },
    { label: 'UK', value: 'uk' },
  ]}
/>

// TextareaField specific
<TextareaField
  name="bio"
  rows={4}
/>

// RadioGroupField specific
<RadioGroupField
  name="plan"
  options={[
    { label: 'Free', value: 'free' },
    { label: 'Pro', value: 'pro' },
  ]}
/>`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
