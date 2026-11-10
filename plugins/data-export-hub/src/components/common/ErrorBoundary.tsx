import { Component, ReactNode } from 'react';
import { Alert, AlertTitle, Button, Box } from '@mui/material';

interface Props {
  children: ReactNode;
  label: string;
}

interface State {
  error: Error | null;
}

/** Keeps a failing tab from taking down the whole Data Export Hub page. */
export class SectionErrorBoundary extends Component<Props, State> {
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  state: State = { error: null };

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error(`[data-export-hub] ${this.props.label} failed`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <Box py={2}>
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => this.setState({ error: null })}
              >
                Retry
              </Button>
            }
          >
            <AlertTitle>{this.props.label} could not be displayed</AlertTitle>
            {this.state.error.message}
          </Alert>
        </Box>
      );
    }
    return this.props.children;
  }
}
