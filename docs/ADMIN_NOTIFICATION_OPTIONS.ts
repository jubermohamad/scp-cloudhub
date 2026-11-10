/**
 * Admin Approval Notification System
 *
 * OPTIONAL ENHANCEMENT: Notify admins when deployments need approval
 *
 * Three implementation options:
 * 1. Email notifications (simplest)
 * 2. Slack notifications (team-friendly)
 * 3. Admin dashboard (most comprehensive)
 *
 * This file provides sample implementations.
 */

// ============================================================================
// OPTION 1: EMAIL NOTIFICATIONS
// ============================================================================

/**
 * Send email notification when approval is needed
 *
 * Add this handler to your backend deployment-control-plane service:
 */
export const EmailNotificationExample = `
// File: plugins/deployment-control-plane-backend/src/handlers/approval.ts

import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

export async function handleApprovalCreated(approval: ApprovalRequest) {
  const adminEmails = await getAdminGroupEmails('GRP-CloudHub-PlatformAdmin');
  
  const emailContent = \`
    <h2>Deployment Approval Required</h2>
    
    <p>A new deployment is awaiting your approval:</p>
    
    <table border="1" cellpadding="8">
      <tr><td><strong>Component</strong></td><td>\${approval.component}</td></tr>
      <tr><td><strong>Instance</strong></td><td>\${approval.instance}</td></tr>
      <tr><td><strong>Approval ID</strong></td><td>\${approval.id}</td></tr>
      <tr><td><strong>Submitted by</strong></td><td>\${approval.requesterEmail}</td></tr>
      <tr><td><strong>Submitted at</strong></td><td>\${new Date(approval.createdAt).toISOString()}</td></tr>
    </table>
    
    <h3>Helmfile Preview</h3>
    <pre><code>\${approval.helmfile}</code></pre>
    
    <h3>Action Required</h3>
    <p>
      <a href="https://your-platform/admin/approvals/\${approval.id}">
        Review & Approve Deployment
      </a>
    </p>
  \`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'noreply@platform.example.com',
    to: adminEmails.join(','),
    subject: \`[Approval Required] Deploy \${approval.component} to \${approval.cluster}\`,
    html: emailContent,
  });
}

// Call this in your POST /deployments/approvals endpoint:
// 
// const approval = await createApprovalRequest(req.body);
// await handleApprovalCreated(approval);
// res.json({ id: approval.id, status: 'PENDING' });
`;

// ============================================================================
// OPTION 2: SLACK NOTIFICATIONS
// ============================================================================

/**
 * Send Slack notification when approval is needed
 *
 * Prerequisites:
 * - Slack bot token stored in environment: SLACK_BOT_TOKEN
 * - Target channel: #deployments or similar
 */
export const SlackNotificationExample = `
// File: plugins/deployment-control-plane-backend/src/handlers/slack.ts

import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function notifySlackApprovalNeeded(approval: ApprovalRequest) {
  try {
    await slack.chat.postMessage({
      channel: process.env.SLACK_APPROVALS_CHANNEL || '#deployments',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '📋 Deployment Approval Needed',
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: \`*Component:*\\n\${approval.component}\`,
            },
            {
              type: 'mrkdwn',
              text: \`*Instance:*\\n\${approval.instance}\`,
            },
            {
              type: 'mrkdwn',
              text: \`*Cluster:*\\n\${approval.cluster}\`,
            },
            {
              type: 'mrkdwn',
              text: \`*Requested by:*\\n\${approval.requesterEmail}\`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: \`*Approval ID:* \\\`\${approval.id}\\\`\\n*Status:* ⏳ Pending\`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '✅ Approve',
              },
              style: 'primary',
              action_id: \`approval_approve_\${approval.id}\`,
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '❌ Reject',
              },
              style: 'danger',
              action_id: \`approval_reject_\${approval.id}\`,
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '📄 View Helmfile',
              },
              action_id: \`approval_view_\${approval.id}\`,
            },
          ],
        },
      ],
    });

    console.log(\`Slack notification sent for approval: \${approval.id}\`);
  } catch (error) {
    console.error('Failed to send Slack notification:', error);
    // Don't fail the approval creation if Slack notification fails
  }
}

// Call this in your POST /deployments/approvals endpoint:
// 
// const approval = await createApprovalRequest(req.body);
// await notifySlackApprovalNeeded(approval); // Fire and forget
// res.json({ id: approval.id, status: 'PENDING' });
`;

// ============================================================================
// OPTION 3: ADMIN DASHBOARD
// ============================================================================

/**
 * Admin dashboard showing pending approvals
 *
 * React component for admin interface
 */
export const AdminDashboardExample = `
// File: plugins/platform-home/src/components/AdminApprovalsPage.tsx

import React, { useState, useEffect } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Paper,
  Typography,
  TextField,
} from '@mui/material';
import { makeStyles } from '@mui/styles';
import CheckIcon from '@mui/icons-material/Check';
import CancelIcon from '@mui/icons-material/Cancel';
import { useBackendFetch } from '@internal/plugin-platform-common';

interface PendingApproval {
  id: string;
  component: string;
  instance: string;
  cluster: string;
  requesterEmail: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  helmfile: string;
  createdAt: string;
}

export function AdminApprovalsPage() {
  const backendFetch = useBackendFetch();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);

  // Fetch pending approvals
  useEffect(() => {
    const fetchApprovals = async () => {
      try {
        const response = await backendFetch(
          'deployment-control-plane',
          '/deployments/approvals?status=PENDING'
        );
        const data = await response.json();
        setApprovals(data);
      } catch (error) {
        console.error('Failed to fetch approvals:', error);
      }
    };

    fetchApprovals();
    
    // Poll every 10 seconds for new approvals
    const interval = setInterval(fetchApprovals, 10000);
    return () => clearInterval(interval);
  }, [backendFetch]);

  const handleApprove = async (approval: PendingApproval) => {
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        \\\`/deployments/approvals/\\\${approval.id}/approve\\\`,
        { method: 'POST' }
      );

      if (response.ok) {
        // Remove from pending list
        setApprovals(approvals.filter(a => a.id !== approval.id));
        alert('✅ Deployment approved!');
      }
    } catch (error) {
      alert('❌ Failed to approve deployment');
    }
  };

  const handleReject = async (approval: PendingApproval) => {
    try {
      const response = await backendFetch(
        'deployment-control-plane',
        \\\`/deployments/approvals/\\\${approval.id}/reject\\\`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: rejectReason }),
        }
      );

      if (response.ok) {
        setApprovals(approvals.filter(a => a.id !== approval.id));
        setRejectOpen(false);
        setRejectReason('');
        alert('❌ Deployment rejected');
      }
    } catch (error) {
      alert('Failed to reject deployment');
    }
  };

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        📋 Pending Deployments
      </Typography>

      {approvals.length === 0 ? (
        <Paper p={2}>
          <Typography color="textSecondary">
            No pending approvals. All deployments are up to date!
          </Typography>
        </Paper>
      ) : (
        <Table>
          <TableHead>
            <TableRow style={{ backgroundColor: '#f5f5f5' }}>
              <TableCell><strong>Component</strong></TableCell>
              <TableCell><strong>Instance</strong></TableCell>
              <TableCell><strong>Cluster</strong></TableCell>
              <TableCell><strong>Requested by</strong></TableCell>
              <TableCell><strong>Created</strong></TableCell>
              <TableCell><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {approvals.map(approval => (
              <TableRow key={approval.id}>
                <TableCell>{approval.component}</TableCell>
                <TableCell>{approval.instance}</TableCell>
                <TableCell>
                  <Chip label={approval.cluster} size="small" />
                </TableCell>
                <TableCell>{approval.requesterEmail}</TableCell>
                <TableCell>
                  {new Date(approval.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Button
                    size="small"
                    onClick={() => {
                      setSelectedApproval(approval);
                      setPreviewOpen(true);
                    }}
                  >
                    Preview
                  </Button>
                  <Button
                    size="small"
                    color="primary"
                    startIcon={<CheckIcon />}
                    onClick={() => handleApprove(approval)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="small"
                    color="secondary"
                    startIcon={<CancelIcon />}
                    onClick={() => {
                      setSelectedApproval(approval);
                      setRejectOpen(true);
                    }}
                  >
                    Reject
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Preview Helmfile Dialog */}
      <Dialog open={previewOpen} maxWidth="md" fullWidth>
        <DialogTitle>Helmfile Preview</DialogTitle>
        <DialogContent>
          <pre>{selectedApproval?.helmfile}</pre>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Deployment</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Reason for rejection"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="e.g., Invalid namespace, security concerns..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setRejectOpen(false);
            setRejectReason('');
          }}>
            Cancel
          </Button>
          <Button
            onClick={() => handleReject(selectedApproval!)}
            color="secondary"
            variant="contained"
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// Add route to your platform-home plugin:
// <Route path="/admin/approvals" component={AdminApprovalsPage} />
`;

// ============================================================================
// IMPLEMENTATION GUIDE
// ============================================================================

export const ImplementationGuide = `
ADMIN NOTIFICATION SYSTEM - IMPLEMENTATION GUIDE

═══════════════════════════════════════════════════════════════════════════════

OPTION 1: EMAIL NOTIFICATIONS (RECOMMENDED FOR SIMPLE SETUPS)
─────────────────────────────────────────────────────────────

Setup:
  1. Install nodemailer: npm install nodemailer
  2. Set environment variables:
     - SMTP_HOST=smtp.gmail.com
     - SMTP_PORT=587
     - SMTP_USER=your-email@example.com
     - SMTP_PASSWORD=your-app-password
     - SMTP_FROM=noreply@platform.example.com

  3. In your backend POST /deployments/approvals handler:
     await handleApprovalCreated(approval);

Pros:
  ✓ Simple to implement
  ✓ Works with any SMTP server
  ✓ Admins get notifications immediately
  ✓ Can include full Helmfile in email

Cons:
  ✗ Email can be slow
  ✗ May end up in spam
  ✗ No interactive actions in email

═══════════════════════════════════════════════════════════════════════════════

OPTION 2: SLACK NOTIFICATIONS (RECOMMENDED FOR TEAMS)
──────────────────────────────────────────────────────

Setup:
  1. Create Slack Bot:
     - Go to api.slack.com
     - Create new app
     - Add OAuth scopes: chat:write
     - Install app to workspace
     - Copy Bot Token (xoxb-...)

  2. Install @slack/web-api: npm install @slack/web-api

  3. Set environment variables:
     - SLACK_BOT_TOKEN=xoxb-...
     - SLACK_APPROVALS_CHANNEL=#deployments

  4. In your backend POST /deployments/approvals handler:
     await notifySlackApprovalNeeded(approval);

Pros:
  ✓ Team sees notifications immediately
  ✓ Interactive buttons (Approve/Reject from Slack)
  ✓ Conversation history
  ✓ Rich formatting

Cons:
  ✗ Requires Slack setup
  ✗ Interactive buttons need webhook handlers
  ✗ Requires bot token management

═══════════════════════════════════════════════════════════════════════════════

OPTION 3: ADMIN DASHBOARD (RECOMMENDED FOR COMPREHENSIVE)
─────────────────────────────────────────────────────────

Setup:
  1. Add AdminApprovalsPage component to your platform-home plugin
  2. Create route: /admin/approvals
  3. Backend already has the /deployments/approvals?status=PENDING endpoint
  4. Add permission check (admin only):
     if (!user.groups.includes('GRP-CloudHub-PlatformAdmin')) {
       return res.status(403).json({ error: 'Unauthorized' });
     }

Pros:
  ✓ Complete visibility
  ✓ Preview Helmfile inline
  ✓ Approval/rejection with reasons
  ✓ History of all approvals
  ✓ No external dependencies

Cons:
  ✗ Admin must remember to check dashboard
  ✗ Requires polling for real-time updates
  ✗ Can't approve on-the-go

═══════════════════════════════════════════════════════════════════════════════

RECOMMENDED COMBINATION: EMAIL + DASHBOARD
──────────────────────────────────────────

For best results, combine approaches:

1. Email notification → alerts admin immediately
2. Slack (optional) → team collaboration
3. Dashboard → detailed review interface

Implementation:
  POST /deployments/approvals
    → Create approval in database
    → Send email to admin
    → Send Slack message (optional)
    → Return approval ID to client

  Admin:
    → Receives email notification
    → Clicks link to dashboard
    → Reviews Helmfile in detail
    → Approves or rejects with reason
    → Client polls and detects status change

═══════════════════════════════════════════════════════════════════════════════

TESTING YOUR NOTIFICATION SYSTEM
────────────────────────────────

1. Test email:
   npm test -- email.test.ts

2. Test Slack:
   npm test -- slack.test.ts

3. Manual test:
   # Submit approval
   curl -X POST http://localhost:8080/deployments/approvals \\
     -H 'Content-Type: application/json' \\
     -d '{"component":"sri-investigation","instance":"test-001",...}'

   # Check if notification was sent:
   # - Check email inbox
   # - Check #deployments channel in Slack
   # - Check /admin/approvals dashboard

═══════════════════════════════════════════════════════════════════════════════

NEXT STEPS
──────────

1. Choose notification method (Email, Slack, or Dashboard)
2. Implement in your deployment-control-plane-backend plugin
3. Add environment variables to your deployment
4. Test end-to-end with verify-approval-flow.sh
5. Deploy and monitor
`;

export default ImplementationGuide;
