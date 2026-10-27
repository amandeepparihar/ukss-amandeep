import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form } from '@/components/forms/Form';
import { TextField } from '@/components/forms/TextField';
import { RichTextField } from '@/components/forms/RichTextField';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useNotifications } from '@/hooks/useNotifications';
import { Code } from 'lucide-react';

// Form schema for blog post example
const blogPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  excerpt: z.string().max(500, 'Excerpt must be 500 characters or less').optional(),
  content: z.string().min(10, 'Content must be at least 10 characters'),
});

type BlogPostData = z.infer<typeof blogPostSchema>;

// Form schema for email template example
const emailTemplateSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
});

type EmailTemplateData = z.infer<typeof emailTemplateSchema>;

export function RichTextDemo() {
  const { addNotification } = useNotifications();
  const [standaloneContent, setStandaloneContent] = useState<string>(
    '<p>This is a <strong>standalone</strong> rich text editor. Try editing this content!</p><ul><li>Bold, italic, underline</li><li>Headings and lists</li><li>Links and images</li><li>Text alignment</li></ul>'
  );
  const [outputHtml, setOutputHtml] = useState<string>('');

  // Blog post form
  const blogForm = useForm<BlogPostData>({
    resolver: zodResolver(blogPostSchema),
    defaultValues: {
      title: '',
      excerpt: '',
      content: '<p>Start writing your blog post here...</p>',
    },
  });

  // Email template form
  const emailForm = useForm<EmailTemplateData>({
    resolver: zodResolver(emailTemplateSchema),
    defaultValues: {
      subject: '',
      body: '<p>Dear {{name}},</p><p>Thank you for your interest in our services.</p><p>Best regards,<br>The Team</p>',
    },
  });

  const onBlogSubmit = (data: BlogPostData) => {
    console.log('Blog Post Data:', data);
    addNotification({
      type: 'success',
      title: 'Blog Post Created',
      message: `Post "${data.title}" has been created successfully.`,
    });
  };

  const onEmailSubmit = (data: EmailTemplateData) => {
    console.log('Email Template Data:', data);
    addNotification({
      type: 'success',
      title: 'Email Template Saved',
      message: `Template with subject "${data.subject}" has been saved.`,
    });
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-8 p-6">
      <div>
        <h1 className="text-3xl font-bold">Rich Text Editor Demo</h1>
        <p className="mt-2 text-muted-foreground">
          A powerful rich text editor built with Tiptap, integrated with Shadcn/ui and React Hook Form.
        </p>
      </div>

      <Tabs defaultValue="standalone" className="space-y-6">
        <TabsList>
          <TabsTrigger value="standalone">Standalone Editor</TabsTrigger>
          <TabsTrigger value="blog">Blog Post Form</TabsTrigger>
          <TabsTrigger value="email">Email Template</TabsTrigger>
        </TabsList>

        {/* Standalone Editor */}
        <TabsContent value="standalone" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Standalone Rich Text Editor</CardTitle>
              <CardDescription>
                Use the editor directly without form integration. Great for simple content editing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RichTextEditor
                value={standaloneContent}
                onChange={(value) => {
                  setStandaloneContent(value);
                  setOutputHtml(value);
                }}
                placeholder="Start typing here..."
                minHeight="250px"
              />

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Code className="h-4 w-4" />
                  HTML Output
                </div>
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-4 text-xs">
                  {outputHtml || standaloneContent}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Features</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <h4 className="font-medium">Text Formatting</h4>
                  <p className="text-sm text-muted-foreground">
                    Bold, italic, underline, strikethrough, highlight, and inline code.
                  </p>
                </div>
                <div className="space-y-1">
                  <h4 className="font-medium">Headings</h4>
                  <p className="text-sm text-muted-foreground">
                    Three levels of headings (H1, H2, H3) for content structure.
                  </p>
                </div>
                <div className="space-y-1">
                  <h4 className="font-medium">Lists</h4>
                  <p className="text-sm text-muted-foreground">
                    Bullet lists, numbered lists, and blockquotes.
                  </p>
                </div>
                <div className="space-y-1">
                  <h4 className="font-medium">Text Alignment</h4>
                  <p className="text-sm text-muted-foreground">
                    Left, center, right, and justify alignment options.
                  </p>
                </div>
                <div className="space-y-1">
                  <h4 className="font-medium">Links & Images</h4>
                  <p className="text-sm text-muted-foreground">
                    Add hyperlinks, embed images from URLs, paste from clipboard (Ctrl+V), or drag & drop. Images are automatically uploaded to S3/MinIO.
                  </p>
                </div>
                <div className="space-y-1">
                  <h4 className="font-medium">Undo/Redo</h4>
                  <p className="text-sm text-muted-foreground">
                    Full history support with keyboard shortcuts.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Blog Post Form */}
        <TabsContent value="blog" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Blog Post Editor</CardTitle>
              <CardDescription>
                Example of rich text editor integrated with React Hook Form for creating blog posts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...blogForm}>
                <form onSubmit={blogForm.handleSubmit(onBlogSubmit)} className="space-y-6">
                  <TextField<BlogPostData>
                    name="title"
                    label="Post Title"
                    placeholder="Enter your post title"
                    required
                  />

                  <TextField<BlogPostData>
                    name="excerpt"
                    label="Excerpt"
                    placeholder="Brief summary of your post (optional)"
                    description="A short description that appears in post listings."
                  />

                  <RichTextField<BlogPostData>
                    name="content"
                    label="Content"
                    placeholder="Write your blog post content here..."
                    required
                    minHeight="300px"
                    description="Use the toolbar above to format your content."
                  />

                  <div className="flex gap-4">
                    <Button type="submit">Publish Post</Button>
                    <Button type="button" variant="outline" onClick={() => blogForm.reset()}>
                      Reset
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Template Form */}
        <TabsContent value="email" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Email Template Editor</CardTitle>
              <CardDescription>
                Create rich HTML email templates with variable placeholders like {'{{name}}'}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...emailForm}>
                <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-6">
                  <TextField<EmailTemplateData>
                    name="subject"
                    label="Email Subject"
                    placeholder="Enter email subject"
                    required
                  />

                  <RichTextField<EmailTemplateData>
                    name="body"
                    label="Email Body"
                    placeholder="Compose your email template..."
                    required
                    minHeight="250px"
                    description="Use {{variableName}} syntax for dynamic content."
                  />

                  <div className="flex gap-4">
                    <Button type="submit">Save Template</Button>
                    <Button type="button" variant="outline" onClick={() => emailForm.reset()}>
                      Reset
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Available Variables</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1">{'{{name}}'}</code>
                  <span className="text-muted-foreground">Recipient's name</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1">{'{{email}}'}</code>
                  <span className="text-muted-foreground">Recipient's email</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1">{'{{company}}'}</code>
                  <span className="text-muted-foreground">Company name</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1">{'{{date}}'}</code>
                  <span className="text-muted-foreground">Current date</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
