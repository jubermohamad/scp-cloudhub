import { makeStyles } from '@mui/styles';
import { Typography } from '@mui/material';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import { cloudHubOpenApiSpec } from './apiDocumentation';

const useStyles = makeStyles(() => ({
  root: { padding: '24px 32px 48px', maxWidth: 1500, margin: '0 auto' },
  intro: { marginBottom: 20, color: '#6B7280' },
  swagger: {
    '& .swagger-ui': { fontFamily: 'Inter, Roboto, Helvetica Neue, Arial, sans-serif' },
    '& .swagger-ui .information-container': { margin: '0 0 20px' },
    '& .swagger-ui .topbar': { display: 'none' },
    '& .swagger-ui .opblock-tag': { fontSize: '1rem', borderBottom: '1px solid #E5E7EB' },
    '& .swagger-ui .opblock': { borderRadius: 8, boxShadow: 'none' },
  },
}));

export function ApiDocumentationPage() {
  const classes = useStyles();
  return (
    <main className={classes.root}>
      <Typography variant="h4" gutterBottom>CloudHub API Explorer</Typography>
      <Typography className={classes.intro}>
        Explore and authorize CloudHub control-plane and platform-registry endpoints.
      </Typography>
      <div className={classes.swagger}>
        <SwaggerUI spec={cloudHubOpenApiSpec} docExpansion="list" deepLinking tryItOutEnabled={false} />
      </div>
    </main>
  );
}
