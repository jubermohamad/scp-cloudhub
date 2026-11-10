import { useEffect } from 'react';

const SCAFFOLDER_LAYOUT_CLASS = 'cloudhub-scaffolder-layout';
const SCAFFOLDER_STEPPER_CLASS = 'cloudhub-scaffolder-stepper';
const SCAFFOLDER_CONTENT_CLASS = 'cloudhub-scaffolder-content';
const SCAFFOLDER_HIDE_INTRO_CLASS = 'cloudhub-hide-template-intro';
const AKS_ACTION_BAR_CLASS = 'cloudhub-aks-action-bar';

const LEGACY_TEMPLATE_ROUTE_MAP: Record<string, string> = {
  // create-aks-cluster was replaced by the standalone /create/aks page.
  // Redirect any old bookmark directly there.
  'aks-cluster-mock': '/create/aks',
  'create-aks-cluster': '/create/aks',
};

function redirectLegacyTemplateRoute(): boolean {
  const match = window.location.pathname.match(
    /^\/create\/templates\/default\/([^/]+)$/,
  );

  if (!match) {
    return false;
  }

  const currentTemplateName = match[1];
  const mappedTemplateName = LEGACY_TEMPLATE_ROUTE_MAP[currentTemplateName];

  if (!mappedTemplateName) {
    return false;
  }

  // If the mapped value is an absolute path, navigate directly instead of
  // building a scaffolder URL.
  const replacementUrl = mappedTemplateName.startsWith('/')
    ? `${mappedTemplateName}${window.location.search}${window.location.hash}`
    : `/create/templates/default/${mappedTemplateName}${window.location.search}${window.location.hash}`;

  if (
    replacementUrl ===
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  ) {
    return false;
  }

  window.history.replaceState(window.history.state, '', replacementUrl);
  return true;
}

function clearScaffolderLayoutClasses() {
  document.querySelectorAll(`.${SCAFFOLDER_LAYOUT_CLASS}`).forEach(element => {
    element.classList.remove(SCAFFOLDER_LAYOUT_CLASS);
  });
  document.querySelectorAll(`.${SCAFFOLDER_STEPPER_CLASS}`).forEach(element => {
    element.classList.remove(SCAFFOLDER_STEPPER_CLASS);
  });
  document.querySelectorAll(`.${SCAFFOLDER_CONTENT_CLASS}`).forEach(element => {
    element.classList.remove(SCAFFOLDER_CONTENT_CLASS);
  });
  document
    .querySelectorAll(`.${SCAFFOLDER_HIDE_INTRO_CLASS}`)
    .forEach(element => {
      element.classList.remove(SCAFFOLDER_HIDE_INTRO_CLASS);
    });
  document.querySelectorAll(`.${AKS_ACTION_BAR_CLASS}`).forEach(element => {
    element.remove();
  });
}

function setActionValue(action: 'review' | 'update' | 'cancel' | 'create') {
  const actionInput = document.querySelector(
    `input[name="root_action"][value="${action}"]`,
  ) as HTMLInputElement | null;

  if (!actionInput) {
    return false;
  }

  actionInput.click();
  actionInput.dispatchEvent(new Event('change', { bubbles: true }));

  const confirmInput = document.querySelector(
    'input[name="root_confirmReviewed"]',
  ) as HTMLInputElement | null;

  if (confirmInput) {
    const shouldConfirm = action === 'create';
    if (confirmInput.checked !== shouldConfirm) {
      confirmInput.click();
      confirmInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  return true;
}

function injectAksActionButtons() {
  if (!window.location.pathname.includes('/create/aks')) {
    return;
  }

  const form = document.querySelector('form#root') as HTMLFormElement | null;
  if (!form) {
    return;
  }

  const hasActionField = !!document.querySelector('input[name="root_action"]');
  if (!hasActionField) {
    document
      .querySelectorAll(`.${AKS_ACTION_BAR_CLASS}`)
      .forEach(node => node.remove());
    return;
  }

  if (form.nextElementSibling?.classList.contains(AKS_ACTION_BAR_CLASS)) {
    return;
  }

  const actionBar = document.createElement('div');
  actionBar.className = AKS_ACTION_BAR_CLASS;

  const actions: Array<{
    value: 'review' | 'update' | 'cancel' | 'create';
    label: string;
    tone: string;
  }> = [
    { value: 'review', label: 'Review', tone: 'secondary' },
    { value: 'update', label: 'Update', tone: 'secondary' },
    { value: 'cancel', label: 'Cancel', tone: 'danger' },
    { value: 'create', label: 'Create', tone: 'primary' },
  ];

  for (const item of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${AKS_ACTION_BAR_CLASS}-button ${AKS_ACTION_BAR_CLASS}-button--${item.tone}`;
    button.textContent = item.label;
    button.addEventListener('click', () => {
      const actionSet = setActionValue(item.value);
      if (!actionSet) {
        return;
      }

      const submitButton = document.querySelector(
        'form#root + div .MuiButton-containedPrimary, form#root + div button[type="submit"]',
      ) as HTMLButtonElement | null;
      submitButton?.click();
    });
    actionBar.appendChild(button);
  }

  form.insertAdjacentElement('afterend', actionBar);
}

function markAksTemplateIntroForHiding() {
  if (!window.location.pathname.includes('/create/aks')) {
    return;
  }

  const candidates = Array.from(
    document.querySelectorAll('main div, main section, main article'),
  );

  const introBlock = candidates.find(node => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    return (
      text.length > 80 &&
      text.length < 6000 &&
      text.includes('Create Kubernetes Cluster (AKS)') &&
      text.includes('Lifecycle actions:') &&
      text.includes('Cluster name format')
    );
  });

  if (introBlock instanceof HTMLElement) {
    introBlock.classList.add(SCAFFOLDER_HIDE_INTRO_CLASS);
  }
}

function applyScaffolderLayoutClasses() {
  if (redirectLegacyTemplateRoute()) {
    window.requestAnimationFrame(applyScaffolderLayoutClasses);
    return;
  }

  if (!window.location.pathname.startsWith('/create/templates/')) {
    clearScaffolderLayoutClasses();
    return;
  }

  const stepper = document.querySelector(
    '.MuiStepper-root.MuiStepper-horizontal',
  );
  const form = document.querySelector('form#root');

  if (!(stepper instanceof HTMLElement) || !(form instanceof HTMLElement)) {
    return;
  }

  let layoutRoot: HTMLElement | null = stepper.parentElement;
  while (layoutRoot && !layoutRoot.contains(form)) {
    layoutRoot = layoutRoot.parentElement;
  }

  if (!layoutRoot) {
    return;
  }

  const contentRoot = Array.from(layoutRoot.children).find(
    child => child !== stepper && child.contains(form),
  );

  clearScaffolderLayoutClasses();
  layoutRoot.classList.add(SCAFFOLDER_LAYOUT_CLASS);
  stepper.classList.add(SCAFFOLDER_STEPPER_CLASS);

  if (contentRoot instanceof HTMLElement) {
    contentRoot.classList.add(SCAFFOLDER_CONTENT_CLASS);
  }

  markAksTemplateIntroForHiding();
  injectAksActionButtons();
}

export function ScaffolderLayoutEnhancer() {
  useEffect(() => {
    applyScaffolderLayoutClasses();

    const observer = new MutationObserver(() => {
      applyScaffolderLayoutClasses();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const onNavigation = () => {
      window.requestAnimationFrame(applyScaffolderLayoutClasses);
    };

    window.addEventListener('popstate', onNavigation);
    window.addEventListener('hashchange', onNavigation);

    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', onNavigation);
      window.removeEventListener('hashchange', onNavigation);
      clearScaffolderLayoutClasses();
    };
  }, []);

  return null;
}
