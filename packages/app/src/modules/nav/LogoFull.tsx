import { makeStyles } from '@mui/styles';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    height: 30,
    color: '#111827',
    backgroundColor: '#FFFFFF',
    borderRadius: 4,
    padding: '0 10px',
    fontSize: '1rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
    fontFamily: '"Poppins", "Segoe UI", sans-serif',
  },
});

export const LogoFull = () => {
  const classes = useStyles();

  return <span className={classes.root}>Symphony Cloud Platform</span>;
};
