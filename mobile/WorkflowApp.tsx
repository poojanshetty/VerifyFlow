import * as DocumentPicker from 'expo-document-picker';

import { StatusBar } from 'expo-status-bar';

import React, { useEffect, useState } from 'react';

import {

  Alert,

  ImageBackground,

  Pressable,

  SafeAreaView,

  ScrollView,

  StyleSheet,

  Text,

  TextInput,

  View,
  useWindowDimensions,
} from 'react-native';



type Role = 'admin' | 'bank_client' | 'worker';

type CaseStatus = 'In review' | 'Needs info' | 'Approved' | 'Rejected';

type User = { id: string; username: string; role: Role };

type ApplicantDetails = {

  applicant: string;

  phone: string;

  email: string;

  address: string;

  permanent_address: string;

  aadhaar_last4: string;

  account_last4: string;

  account_count: number;

  other_loans: boolean;

  income: string;

  company: string;

  bank_credits: string;

};

type VerificationEvent = { status: string; comment: string; verified_by: string; created_at: string };

type LoanCase = {

  id: string;

  reference: string;

  status: CaseStatus;

  assignee: string;

  assigned_worker_id: string | null;

  details: ApplicantDetails;

  comment: string;

  created_at: string;

  documents: { id: string; name: string; content_type: string }[];

  verification_history: VerificationEvent[];

  verified_by: string | null;

};

type StaffUser = User & { name: string; aadhaar_last4: string; address: string; permanent_address: string; work_hours: string };

type Summary = { total: number; verified: number; approved: number; rejected: number; in_review: number };

type PickedFile = { name: string; uri: string; mimeType?: string | null };



const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8001';

const LOCAL_API_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '10.0.2.2']);

const emptyDetails: ApplicantDetails = {

  applicant: '', phone: '', email: '', address: '', permanent_address: '', aadhaar_last4: '',

  account_last4: '', account_count: 1, other_loans: false, income: '', company: '', bank_credits: '',

};

const blankUser = { username: '', password: '', role: 'worker' as Role, name: '', aadhaar_last4: '', address: '', permanent_address: '', work_hours: '' };

const WORK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {

  const hours = Math.floor(index / 2).toString().padStart(2, '0');

  const minutes = index % 2 === 0 ? '00' : '30';

  return `${hours}:${minutes}`;

});



async function apiRequest<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {

  const endpoint = new URL(path, `${API_URL}/`);

  if (endpoint.protocol !== 'https:' && !LOCAL_API_HOSTS.has(endpoint.hostname)) {

    throw new Error('HTTPS is required before connecting to a non-local server.');

  }

  const headers = new Headers(init.headers);

  if (token) headers.set('Authorization', `Bearer ${token}`);

  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const response = await fetch(endpoint.toString(), { ...init, headers });

  if (!response.ok) {

    const body = await response.json().catch(() => ({}));

    const detail = body.detail;

    if (Array.isArray(detail)) {

      const safeMessages = detail.map((issue: { loc?: unknown[]; msg?: string }) => {

        const location = Array.isArray(issue.loc) ? issue.loc.filter((part) => part !== 'body').join(' > ') : '';

        return location ? `${location}: ${issue.msg ?? 'Invalid value'}` : issue.msg ?? 'Invalid value';

      });

      throw new Error(safeMessages.join('. '));

    }

    throw new Error(typeof detail === 'string' ? detail : `Request failed (${response.status})`);

  }

  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;

}



export default function WorkflowApp() {

  const [user, setUser] = useState<User | null>(null);

  const [token, setToken] = useState<string | null>(null);

  const [cases, setCases] = useState<LoanCase[]>([]);

  const [staff, setStaff] = useState<StaffUser[]>([]);

  const [summary, setSummary] = useState<Summary>({ total: 0, verified: 0, approved: 0, rejected: 0, in_review: 0 });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [page, setPage] = useState<'home' | 'accounts'>('home');

  const [editing, setEditing] = useState(false);

  const [details, setDetails] = useState(emptyDetails);

  const [userForm, setUserForm] = useState(blankUser);

  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; password: string } | null>(null);

  const [comment, setComment] = useState('');

  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([]);

  const [workerId, setWorkerId] = useState('');

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  const [selectedAccount, setSelectedAccount] = useState<StaffUser | null>(null);

  const [resetPassword, setResetPassword] = useState('');

  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);



  const selectedCase = cases.find((item) => item.id === selectedId) ?? null;



  async function refresh(tokenValue: string, role: Role) {

    const [nextCases, nextSummary] = await Promise.all([

      apiRequest<LoanCase[]>('/api/cases', tokenValue),

      apiRequest<Summary>('/api/summary', tokenValue),

    ]);

    setCases(nextCases);

    setSummary(nextSummary);

    if (role === 'admin') setStaff(await apiRequest<StaffUser[]>('/api/users', tokenValue));

  }



  useEffect(() => {

    if (!token || !user) return;

    const update = () => refresh(token, user.role).catch((reason: Error) => setError(reason.message));

    void update();

    const timer = setInterval(update, 15000);

    return () => clearInterval(timer);

  }, [token, user]);



  async function signIn() {

    setBusy(true);

    setError('');

    try {

      const result = await apiRequest<{ access_token: string; user: User }>('/api/auth/login', undefined, {

        method: 'POST', body: JSON.stringify(loginForm),

      });

      setToken(result.access_token);

      setUser(result.user);

      setLoginForm({ username: '', password: '' });

    } catch (reason) {

      setError((reason as Error).message);

    } finally {

      setBusy(false);

    }

  }



  async function refreshNow() {

    if (!token || !user) return;

    setError('');

    try { await refresh(token, user.role); } catch (reason) { setError((reason as Error).message); }

  }



  async function selectDocuments() {

    try {

      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: ['application/pdf', 'image/jpeg', 'image/png'] });

      if (!result.canceled) setPickedFiles((current) => [...current, ...result.assets.map((asset) => ({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType }))]);

    } catch (reason) { setError((reason as Error).message); }

  }



  async function uploadDocuments(caseId: string, files: PickedFile[]) {

    if (!token || files.length === 0) return;

    const body = new FormData();

    for (const file of files) {

      body.append('files', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);

    }

    await apiRequest(`/api/cases/${caseId}/documents`, token, { method: 'POST', body });

  }



  async function saveApplication() {

    if (!token || !user || !details.applicant.trim() || details.aadhaar_last4.length !== 4) {

      Alert.alert('Details needed', 'Enter the applicant name and the last four Aadhaar digits.');

      return;

    }

    setBusy(true);

    setError('');

    try {

      const payload = JSON.stringify({ ...details, account_count: Number(details.account_count) || 0 });

      let saved: LoanCase;

      if (editing && selectedCase) {

        saved = await apiRequest<LoanCase>(`/api/cases/${selectedCase.id}`, token, { method: 'PUT', body: payload });

      } else {

        saved = await apiRequest<LoanCase>('/api/cases', token, { method: 'POST', body: payload });

      }

      await uploadDocuments(saved.id, pickedFiles);

      setPickedFiles([]);

      setEditing(false);

      setDetails(emptyDetails);

      await refresh(token, user.role);

      setSelectedId(saved.id);

    } catch (reason) { setError((reason as Error).message); }

    finally { setBusy(false); }

  }



  async function saveDecision(status: 'Approved' | 'Rejected') {

    if (!token || !selectedCase || !comment.trim()) {

      Alert.alert('Review note required', 'Add the reason for your decision before continuing.');

      return;

    }

    setBusy(true);

    setError('');

    try {

      await apiRequest(`/api/cases/${selectedCase.id}/decision`, token, { method: 'POST', body: JSON.stringify({ status, comment }) });

      setComment('');

      await refreshNow();

    } catch (reason) { setError((reason as Error).message); }

    finally { setBusy(false); }

  }



  async function saveUser(workHours: string) {

    const username = userForm.username.trim();

    const name = userForm.name.trim();

    if (!token || !username || !name || userForm.password.length < 12) {

      Alert.alert('Complete account details', 'Add a name, username, and a password of at least 12 characters.');

      return;

    }

    setBusy(true);

    setError('');

    try {

      await apiRequest('/api/users', token, { method: 'POST', body: JSON.stringify({ ...userForm, username, name, work_hours: workHours }) });

      setCreatedCredentials({ username, password: userForm.password });

      setUserForm(blankUser);

      await refreshNow();

    } catch (reason) { setError((reason as Error).message); }

    finally { setBusy(false); }

  }



  async function assignCase(item: LoanCase) {

    if (!token || !workerId) return;

    setBusy(true);

    try {

      await apiRequest(`/api/cases/${item.id}/assignment`, token, { method: 'PATCH', body: JSON.stringify({ worker_id: workerId }) });

      await refreshNow();

    } catch (reason) { setError((reason as Error).message); }

    finally { setBusy(false); }

  }



  async function saveAccountChanges() {

    if (!token || !selectedAccount) return;

    setBusy(true);

    setError('');

    try {

      await apiRequest(`/api/users/${selectedAccount.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          username: selectedAccount.username.trim(),
          name: selectedAccount.name.trim(),
          aadhaar_last4: selectedAccount.aadhaar_last4,
          address: selectedAccount.address,
          permanent_address: selectedAccount.permanent_address,
          work_hours: selectedAccount.work_hours,
        }),
      });

      await refreshNow();

      setSelectedAccount(null);

    } catch (reason) { setError((reason as Error).message); }

    finally { setBusy(false); }

  }



  async function resetAccountPassword() {

    if (!token || !selectedAccount || resetPassword.length < 12) {
      Alert.alert('Password reset needs 12+ characters', 'Enter a new temporary password of at least 12 characters.');
      return;
    }

    setBusy(true);

    setError('');

    try {

      await apiRequest(`/api/users/${selectedAccount.id}/password`, token, { method: 'POST', body: JSON.stringify({ password: resetPassword }) });

      setResetPassword('');

      Alert.alert('Password updated', `A new temporary password is now active for ${selectedAccount.username}. Share it through an approved private channel.`);

    } catch (reason) { setError((reason as Error).message); }

    finally { setBusy(false); }

  }



  async function deleteAccount() {

    if (!token || !selectedAccount) return;

    const confirmed = typeof window === 'undefined' ? false : window.confirm(`Delete ${selectedAccount.name}'s account? Accounts linked to case history are protected by the API.`);

    if (!confirmed) return;

    setBusy(true);

    setError('');

    try {

      await apiRequest(`/api/users/${selectedAccount.id}`, token, { method: 'DELETE' });

      setSelectedAccount(null);

      await refreshNow();

    } catch (reason) { setError((reason as Error).message); }

    finally { setBusy(false); }

  }



  function openEdit(item: LoanCase) {

    setSelectedId(item.id);

    setDetails(item.details);

    setPickedFiles([]);

    setEditing(true);

  }



  function signOut() {

    setToken(null);

    setUser(null);

    setCases([]);

    setStaff([]);

    setSelectedId(null);

    setPage('home');

    setError('');

  }



  if (!user || !token) {

    return <LoginScreen form={loginForm} setForm={setLoginForm} onSubmit={signIn} error={error} busy={busy} />;

  }



  if (user.role === 'bank_client' && (editing || selectedId === 'new')) {

    return <ApplicationForm details={details} setDetails={setDetails} pickedFiles={pickedFiles} onPick={selectDocuments} onSave={saveApplication} onCancel={() => { setEditing(false); setSelectedId(null); setPickedFiles([]); }} busy={busy} error={error} editing={editing} onRefresh={refreshNow} />;

  }



  if (user.role === 'admin' && page === 'accounts') {

    return <AdminAccounts user={user} form={userForm} setForm={setUserForm} staff={staff} selectedAccount={selectedAccount} onSelectAccount={(account) => { setSelectedAccount(account); setResetPassword(''); }} onSaveSelected={saveAccountChanges} onResetPassword={resetAccountPassword} onDeleteAccount={deleteAccount} resetPassword={resetPassword} setResetPassword={setResetPassword} onSave={saveUser} onBack={() => setPage('home')} busy={busy} error={error} credentials={createdCredentials} onDismissCredentials={() => setCreatedCredentials(null)} onRefresh={refreshNow} />;

  }



  if (selectedCase) {

    return <CaseDetail

      user={user}

      item={selectedCase}

      comment={comment}

      setComment={setComment}

      staff={staff.filter((person) => person.role === 'worker')}

      workerId={workerId}

      setWorkerId={setWorkerId}

      onBack={() => { setSelectedId(null); setEditing(false); }}

      onEdit={() => openEdit(selectedCase)}

      onAssign={() => assignCase(selectedCase)}

      onDecision={saveDecision}

      busy={busy}

      error={error}

      onRefresh={refreshNow}

    />;

  }



  return <Dashboard

    user={user}

    cases={cases}

    summary={summary}

    onSelect={(item) => { setSelectedId(item.id); setComment(''); }}

    onNew={() => { setDetails(emptyDetails); setEditing(false); setSelectedId('new'); }}

    onHome={() => { setSelectedId(null); setEditing(false); setPage('home'); }}

    onApplications={() => { setSelectedId(null); setEditing(false); setPage('home'); }}

    onAccounts={() => setPage('accounts')}

    onSignOut={signOut}

    onRefresh={refreshNow}

    error={error}

  />;

}



function LoginScreen({ form, setForm, onSubmit, error, busy }: {

  form: { username: string; password: string };

  setForm: (form: { username: string; password: string }) => void;

  onSubmit: () => void;

  error: string;

  busy: boolean;

}) {

  return <ImageBackground source={require('./assets/1.jpg')} style={styles.backgroundImage} resizeMode="cover"><View style={styles.loginWash}><SafeAreaView style={styles.safe}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.loginPage}>

    <View style={styles.loginBrand}><View style={styles.logo}><Text style={styles.logoText}>V</Text></View><Text style={styles.brand}>VERIFYFLOW</Text><Text style={styles.brandSub}>VERIFICATION OPERATIONS</Text></View>

    <View style={styles.loginPanel}><Text style={styles.kicker}>SECURE WORKSPACE</Text><Text style={styles.pageTitle}>Welcome back</Text><Text style={styles.muted}>Sign in with the account issued by your administrator.</Text>

      <Field label="Username" value={form.username} onChangeText={(username) => setForm({ ...form, username })} autoCapitalize="none" />

      <Field label="Password" value={form.password} onChangeText={(password) => setForm({ ...form, password })} secureTextEntry />

      {error ? <ErrorText>{error}</ErrorText> : null}

      <PrimaryButton label={busy ? 'Signing in...' : 'Sign in'} onPress={onSubmit} disabled={busy} />

      <Text style={styles.loginFoot}>Accounts are created by your VerifyFlow administrator.</Text>

    </View>

    <Text style={styles.demoFoot}>DEMO ONLY - DO NOT ENTER REAL CUSTOMER DATA</Text>

  </ScrollView></SafeAreaView></View></ImageBackground>;

}



function Dashboard({ user, cases, summary, onSelect, onNew, onAccounts, onHome, onApplications, onSignOut, onRefresh, error }: {

  user: User; cases: LoanCase[]; summary: Summary; onSelect: (item: LoanCase) => void; onNew: () => void;

  onAccounts: () => void; onHome: () => void; onApplications: () => void; onSignOut: () => void; onRefresh: () => void; error: string;

}) {

  const title = user.role === 'admin' ? 'Operations overview' : user.role === 'worker' ? 'My verification queue' : 'Your applications';

  const workspaceLabel = user.role === 'worker'

    ? 'EMPLOYEE'

    : user.role === 'bank_client'

      ? 'CLIENT'

      : 'ADMINISTRATOR';

  const completedCases = cases.filter((item) => item.status === 'Approved' || item.status === 'Rejected');

  return <Shell user={user} activeSection="home" onBack={onSignOut} backLabel="Sign out" onRefresh={onRefresh} onNavigateHome={onHome} onNavigateApplications={onApplications} onNavigatePeople={onAccounts}>

    <View style={styles.headingRow}><View style={styles.grow}><Text style={styles.kicker}>{workspaceLabel} WORKSPACE</Text><Text style={styles.pageTitle}>{title}</Text><Text style={styles.muted}>Welcome, {user.username}</Text></View>

      {user.role === 'bank_client' && <Pressable style={styles.smallAction} onPress={onNew}><Text style={styles.smallActionText}>+ New case</Text></Pressable>}

      {user.role === 'admin' && <Pressable style={styles.smallAction} onPress={onAccounts}><Text style={styles.smallActionText}>People & access</Text></Pressable>}

    </View>

    <View style={styles.metrics}>{[

      ['In review', summary.in_review, 'orange'], ['Approved', summary.approved, 'teal'], ['Rejected', summary.rejected, 'coral'],

    ].map(([label, value, color]) => <View style={styles.metric} key={String(label)}><Text style={[styles.metricValue, { color: palette[color as keyof typeof palette] }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>)}</View>

    {error ? <ErrorText>{error}</ErrorText> : null}

    {user.role === 'bank_client' ? <View style={styles.notificationPanel}>

      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Notifications</Text><Text style={styles.notificationCount}>{completedCases.length} completed</Text></View>

      {completedCases.length === 0

        ? <Text style={styles.muted}>Completed ticket decisions will appear here.</Text>

        : completedCases.map((item) => <Pressable key={item.id} style={styles.notificationItem} onPress={() => onSelect(item)}>

          <View style={styles.rowBetween}><Text style={styles.notificationReference}>{item.reference} completed</Text><StatusBadge status={item.status} /></View>

          <Text style={styles.notificationComment}>{item.comment || 'No decision comment provided.'}</Text>

          {item.verified_by ? <Text style={styles.mutedSmall}>Verified by {item.verified_by}</Text> : null}

        </Pressable>)}

      <Text style={styles.notificationFoot}>Updates refresh while you are signed in.</Text>

    </View> : null}

    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{user.role === 'worker' ? 'Assigned clients' : user.role === 'bank_client' ? 'Submitted applications' : 'All applications'}</Text><Text style={styles.mutedSmall}>{summary.total} total</Text></View>

    {cases.length === 0 ? <EmptyState message={user.role === 'worker' ? 'No applications are assigned to you.' : 'No applications have been submitted yet.'} /> : cases.map((item) => <CaseRow key={item.id} item={item} showClientContact={user.role === 'worker'} onPress={() => onSelect(item)} />)}

  </Shell>;

}



function CaseDetail({ user, item, comment, setComment, staff, workerId, setWorkerId, onBack, onEdit, onAssign, onDecision, busy, error, onRefresh }: {

  user: User; item: LoanCase; comment: string; setComment: (value: string) => void; staff: StaffUser[]; workerId: string;

  setWorkerId: (value: string) => void; onBack: () => void; onEdit: () => void; onAssign: () => void;

  onDecision: (status: 'Approved' | 'Rejected') => void; busy: boolean; error: string; onRefresh: () => void;

}) {

  const canEdit = user.role === 'bank_client' && item.status !== 'Approved' && item.status !== 'Rejected';

  return <Shell user={user} activeSection="applications" onBack={onBack} backLabel="Applications" onRefresh={onRefresh}>

    <View style={styles.headingRow}><View style={styles.grow}><Text style={styles.kicker}>{item.reference}</Text><Text style={styles.pageTitle}>{item.details.applicant}</Text><Text style={styles.muted}>Assigned to {item.assignee}</Text></View><StatusBadge status={item.status} /></View>

    {error ? <ErrorText>{error}</ErrorText> : null}

    {canEdit ? <Pressable style={styles.outlineAction} onPress={onEdit}><Text style={styles.outlineActionText}>Edit application details</Text></Pressable> : null}

    <Section title="Applicant details">

      <Info label="Phone" value={item.details.phone} /><Info label="Email" value={item.details.email} />

      <Info label="Current address" value={item.details.address} /><Info label="Permanent address" value={item.details.permanent_address} />

      <Info label="Aadhaar" value={`**** ${item.details.aadhaar_last4}`} />

    </Section>

    <Section title="Financial profile">

      <Info label="Annual income" value={item.details.income} /><Info label="Employer" value={item.details.company} />

      <Info label="Bank accounts" value={`${item.details.account_count} - ${item.details.account_last4 ? `**** ${item.details.account_last4}` : 'Not provided'}`} />

      <Info label="Other loans" value={item.details.other_loans ? 'Yes, declared' : 'None declared'} /><Info label="Bank credits" value={item.details.bank_credits} />

    </Section>

    <Section title={`Documents stored (${item.documents.length})`}>

      {item.documents.length ? item.documents.map((document) => <Text key={document.id} style={styles.documentRow}>PDF / IMAGE  -  {document.name}</Text>) : <Text style={styles.muted}>No documents uploaded.</Text>}

    </Section>

    {user.role === 'admin' ? <Section title="Assignment">

      <Text style={styles.fieldLabel}>Choose a verifier</Text>

      <View style={styles.chipList}>{staff.map((person) => <Pressable key={person.id} onPress={() => setWorkerId(person.id)} style={[styles.chip, workerId === person.id && styles.chipSelected]}><Text style={[styles.chipText, workerId === person.id && styles.chipTextSelected]}>{person.name} - {person.work_hours || 'Daily hours not set'}</Text></Pressable>)}</View>

      <PrimaryButton label={busy ? 'Saving...' : 'Assign application'} onPress={onAssign} disabled={busy || !workerId} />

    </Section> : null}

    {item.verification_history.length > 0 ? <Section title={`Verification history (${item.verification_history.length})`}>

      {item.verification_history.map((event, index) => <View key={`${event.created_at}-${index}`} style={styles.historyItem}>

        <View style={styles.historyTop}><StatusBadge status={event.status as CaseStatus} /><Text style={styles.mutedSmall}>By {event.verified_by} - {new Date(event.created_at).toLocaleString()}</Text></View>

        <Text style={styles.historyComment}>{event.comment}</Text>

      </View>)}

    </Section> : null}

    {user.role === 'worker' && item.status === 'In review' ? <View style={styles.reviewPanel}>

      <Text style={styles.sectionTitle}>Verification decision</Text><Text style={styles.muted}>Enter the reason for your approval or rejection. The client will see it.</Text>

      <TextInput value={comment} onChangeText={setComment} multiline placeholder="Explain why you recommend approval or rejection..." placeholderTextColor={palette.muted} style={[styles.input, styles.multiline]} />

      <View style={styles.decisionButtons}><Pressable style={styles.rejectButton} onPress={() => onDecision('Rejected')} disabled={busy}><Text style={styles.rejectText}>Reject</Text></Pressable><View style={styles.grow}><PrimaryButton label={busy ? 'Saving...' : 'Approve'} onPress={() => onDecision('Approved')} disabled={busy} /></View></View>

    </View> : null}

  </Shell>;

}



function ApplicationForm({ details, setDetails, pickedFiles, onPick, onSave, onCancel, busy, error, editing, onRefresh }: {

  details: ApplicantDetails; setDetails: (details: ApplicantDetails) => void; pickedFiles: PickedFile[];

  onPick: () => void; onSave: () => void; onCancel: () => void; busy: boolean; error: string; editing: boolean; onRefresh: () => void;

}) {

  const set = (field: keyof ApplicantDetails, value: string | number | boolean) => setDetails({ ...details, [field]: value });

  return <Shell activeSection="applications" onBack={onCancel} backLabel="Applications" onRefresh={onRefresh}>

    <Text style={styles.kicker}>CLIENT - SECURE SUBMISSION</Text><Text style={styles.pageTitle}>{editing ? 'Update application' : 'New application'}</Text>

    <Text style={styles.formNotice}>Only the last four Aadhaar and account digits are collected here. Never enter a full identifier.</Text>

    <Section title="Applicant details">

      <Field label="Full name *" value={details.applicant} onChangeText={(v) => set('applicant', v)} />

      <Field label="Phone" value={details.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" />

      <Field label="Email" value={details.email} onChangeText={(v) => set('email', v)} keyboardType="email-address" />

      <Field label="Aadhaar last four digits *" value={details.aadhaar_last4} onChangeText={(v) => set('aadhaar_last4', v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />

      <Field label="Current address" value={details.address} onChangeText={(v) => set('address', v)} />

      <Field label="Permanent address" value={details.permanent_address} onChangeText={(v) => set('permanent_address', v)} />

    </Section>

    <Section title="Financial details">

      <Field label="Annual income (INR)" value={details.income} onChangeText={(v) => set('income', v)} keyboardType="numeric" />

      <Field label="Company / employer" value={details.company} onChangeText={(v) => set('company', v)} />

      <Field label="Bank account last four digits" value={details.account_last4} onChangeText={(v) => set('account_last4', v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />

      <Field label="Number of bank accounts" value={String(details.account_count)} onChangeText={(v) => set('account_count', Number(v.replace(/\D/g, '')) || 0)} keyboardType="number-pad" />

      <Field label="Other bank loans? Enter yes or no" value={details.other_loans ? 'Yes' : 'No'} onChangeText={(v) => set('other_loans', v.toLowerCase() === 'yes')} />

      <Field label="Bank credit pattern" value={details.bank_credits} onChangeText={(v) => set('bank_credits', v)} />

    </Section>

    <Pressable style={styles.uploadButton} onPress={onPick}><Text style={styles.outlineActionText}>+ Choose supporting documents</Text></Pressable>

    {[...pickedFiles.map((file) => file.name), ...(editing ? [] : [])].map((name, index) => <Text style={styles.documentRow} key={`${name}-${index}`}>Selected - {name}</Text>)}

    {error ? <ErrorText>{error}</ErrorText> : null}

    <View style={styles.decisionButtons}><Pressable style={styles.rejectButton} onPress={onCancel}><Text style={styles.rejectText}>Cancel</Text></Pressable><View style={styles.grow}><PrimaryButton label={busy ? 'Saving...' : editing ? 'Save changes' : 'Submit application'} onPress={onSave} disabled={busy} /></View></View>

  </Shell>;

}



function AdminAccounts({ user, form, setForm, staff, selectedAccount, onSelectAccount, onSaveSelected, onResetPassword, onDeleteAccount, resetPassword, setResetPassword, onSave, onBack, busy, error, credentials, onDismissCredentials, onRefresh }: {

  user: User; form: typeof blankUser; setForm: (form: typeof blankUser) => void; staff: StaffUser[]; selectedAccount: StaffUser | null; onSelectAccount: (account: StaffUser | null) => void; onSaveSelected: () => void; onResetPassword: () => void; onDeleteAccount: () => void; resetPassword: string; setResetPassword: (value: string) => void;

  onSave: (workHours: string) => void; onBack: () => void; busy: boolean; error: string; credentials: { username: string; password: string } | null; onDismissCredentials: () => void; onRefresh: () => void;

}) {

  const set = (key: keyof typeof blankUser, value: string | Role) => setForm({ ...form, [key]: value });

  const [dailyHours, setDailyHours] = useState('8');

  const [selectedDays, setSelectedDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

  const [startTime, setStartTime] = useState('09:00');

  const [endTime, setEndTime] = useState('17:00');



  function submitAccount() {

    if (form.role === 'worker' && selectedDays.length === 0) {

      Alert.alert('Choose workdays', 'Select at least one day for this worker.');

      return;

    }

    if (form.role === 'worker' && TIME_OPTIONS.indexOf(endTime) <= TIME_OPTIONS.indexOf(startTime)) {

      Alert.alert('Check shift times', 'The end time must be later than the start time.');

      return;

    }

    const schedule = form.role === 'worker'

      ? `${dailyHours} hours/day; ${WORK_DAYS.filter((day) => selectedDays.includes(day)).join(', ')}; ${startTime}-${endTime}`

      : '';

    onSave(schedule);

  }



  function toggleWorkDay(day: string) {

    setSelectedDays((current) => current.includes(day)

      ? current.filter((selected) => selected !== day)

      : [...current, day]);

  }



  return <Shell user={user} activeSection="people" onBack={onBack} backLabel="Operations overview" onNavigateHome={onBack} onRefresh={onRefresh}>

    <Text style={styles.kicker}>PEOPLE & ACCESS</Text><Text style={styles.pageTitle}>Manage accounts</Text>

    <Text style={styles.formNotice}>Create employee and client access. Share initial credentials through an approved private channel.</Text>

    {credentials ? <Pressable style={styles.notice} onPress={onDismissCredentials}><Text style={styles.noticeTitle}>Account created - initial credentials</Text><Text style={styles.muted}>Username: {credentials.username}</Text><Text style={styles.muted}>Temporary password: {credentials.password}</Text><Text style={styles.muted}>Share privately, then dismiss this notice.</Text></Pressable> : null}

    <Section title="Create account">

      <View style={styles.chipList}>{(['worker', 'bank_client'] as Role[]).map((role) => <Pressable key={role} onPress={() => set('role', role)} style={[styles.chip, form.role === role && styles.chipSelected]}><Text style={[styles.chipText, form.role === role && styles.chipTextSelected]}>{role === 'worker' ? 'Employee' : 'Client'}</Text></Pressable>)}</View>

      <Field label="Full name" value={form.name} onChangeText={(v) => set('name', v)} />

      <Field label="Username" value={form.username} onChangeText={(v) => set('username', v)} autoCapitalize="none" />

      <Field label="Initial password (minimum 12 characters)" value={form.password} onChangeText={(v) => set('password', v)} secureTextEntry />

      {form.role === 'worker' ? <>

        <Field label="Aadhaar last four digits" value={form.aadhaar_last4} onChangeText={(v) => set('aadhaar_last4', v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />

        <Field label="Current address" value={form.address} onChangeText={(v) => set('address', v)} />

        <Field label="Permanent address" value={form.permanent_address} onChangeText={(v) => set('permanent_address', v)} />

        <Text style={styles.fieldLabel}>Workdays</Text>

        <View style={styles.chipList}>{WORK_DAYS.map((day) => <Pressable key={day} onPress={() => toggleWorkDay(day)} style={[styles.chip, selectedDays.includes(day) && styles.chipSelected]}><Text style={[styles.chipText, selectedDays.includes(day) && styles.chipTextSelected]}>{day}</Text></Pressable>)}</View>

        <View style={styles.scheduleGrid}>

          <View style={styles.scheduleCell}><ChoiceSelect label="Hours per day" value={`${dailyHours} hours`} options={Array.from({ length: 16 }, (_, index) => `${index + 1} hours`)} onChange={(value) => setDailyHours(value.split(' ')[0])} /></View>

          <View style={styles.scheduleCell}><ChoiceSelect label="Shift starts" value={startTime} options={TIME_OPTIONS} onChange={setStartTime} /></View>

          <View style={styles.scheduleCell}><ChoiceSelect label="Shift ends" value={endTime} options={TIME_OPTIONS} onChange={setEndTime} /></View>

        </View>

      </> : null}

      {error ? <ErrorText>{error}</ErrorText> : null}<PrimaryButton label={busy ? 'Creating...' : 'Create account'} onPress={submitAccount} disabled={busy} />

    </Section>

    <Section title={`Team accounts (${staff.length})`}>

      {staff.map((person) => <Pressable key={person.id} style={[styles.staffRow, selectedAccount?.id === person.id && styles.staffRowSelected]} onPress={() => onSelectAccount(person)}>

        <View style={[styles.staffAvatar, person.role === 'worker' ? styles.employeeAvatar : styles.clientAvatar]}>

          <Text style={styles.staffAvatarText}>{person.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</Text>

        </View>

        <View style={styles.staffDetails}>

          <Text style={styles.staffName}>{person.name}</Text>

          <Text style={styles.mutedSmall}>{person.username}  ·  {person.role === 'worker' ? `Employee  ·  ${person.work_hours || 'Daily hours not set'}` : 'Client'}</Text>

        </View>

        <Text style={styles.manageLink}>Manage</Text>

      </Pressable>)}

    </Section>

    {selectedAccount ? <AccountEditor account={selectedAccount} setAccount={onSelectAccount} resetPassword={resetPassword} setResetPassword={setResetPassword} onSave={onSaveSelected} onResetPassword={onResetPassword} onDelete={onDeleteAccount} busy={busy} /> : null}

  </Shell>;

}



function AccountEditor({ account, setAccount, resetPassword, setResetPassword, onSave, onResetPassword, onDelete, busy }: {
  account: StaffUser;
  setAccount: (account: StaffUser) => void;
  resetPassword: string;
  setResetPassword: (value: string) => void;
  onSave: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const set = (field: keyof StaffUser, value: string) => setAccount({ ...account, [field]: value });

  return <View style={styles.accountEditor}>
    <Text style={styles.sectionTitle}>Edit {account.role === 'worker' ? 'employee' : 'client'} account</Text>
    <Field label="Full name" value={account.name} onChangeText={(value) => set('name', value)} />
    <Field label="Username" value={account.username} onChangeText={(value) => set('username', value)} autoCapitalize="none" />
    {account.role === 'worker' ? <>
      <Field label="Aadhaar last four digits" value={account.aadhaar_last4} onChangeText={(value) => set('aadhaar_last4', value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
      <Field label="Current address" value={account.address} onChangeText={(value) => set('address', value)} />
      <Field label="Permanent address" value={account.permanent_address} onChangeText={(value) => set('permanent_address', value)} />
      <Field label="Daily hours / shift" value={account.work_hours} onChangeText={(value) => set('work_hours', value)} />
    </> : null}
    <PrimaryButton label={busy ? 'Saving...' : 'Save account details'} onPress={onSave} disabled={busy} />
    <View style={styles.separator} />
    <Text style={styles.fieldLabel}>Reset password</Text>
    <Text style={styles.mutedSmall}>Enter a new temporary password of at least 12 characters. Share it privately with the account holder.</Text>
    <Field label="New temporary password" value={resetPassword} onChangeText={setResetPassword} secureTextEntry />
    <View style={styles.decisionButtons}>
      <Pressable style={styles.rejectButton} onPress={onDelete} disabled={busy}><Text style={styles.rejectText}>Delete account</Text></Pressable>
      <View style={styles.grow}><PrimaryButton label={busy ? 'Updating...' : 'Reset password'} onPress={onResetPassword} disabled={busy} /></View>
    </View>
  </View>;
}



function Shell({ user, activeSection, children, onBack, backLabel, onRefresh, onNavigateHome, onNavigateApplications, onNavigatePeople }: { user?: User; activeSection: 'home' | 'applications' | 'people'; children: React.ReactNode; onBack: () => void; backLabel: string; onRefresh?: () => void; onNavigateHome?: () => void; onNavigateApplications?: () => void; onNavigatePeople?: () => void }) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const roleLabel = user?.role === 'admin' ? 'ADMIN WORKSPACE' : user?.role === 'worker' ? 'FIELD OPERATIONS' : 'CLIENT PORTAL';
  return (
    <SafeAreaView style={styles.appSafe}>
      <StatusBar style="light" />
      <View style={[styles.shell, compact && styles.shellCompact]}>
        {!compact ? (
          <View style={styles.sidebar}>
            <View style={styles.sidebarBrandRow}>
              <View style={styles.sidebarLogo}><Text style={styles.sidebarLogoText}>V</Text></View>
              <View><Text style={styles.sidebarBrand}>VerifyFlow</Text><Text style={styles.sidebarSub}>LOAN OPERATIONS</Text></View>
            </View>
            <Text style={styles.navCaption}>WORKSPACE</Text>
            <Pressable style={activeSection === 'home' ? styles.navItemActive : styles.navItem} onPress={onNavigateHome} disabled={!onNavigateHome}><Text style={styles.navIcon}>▦</Text><Text style={activeSection === 'home' ? styles.navTextActive : styles.navText}>Overview</Text></Pressable>
            {user?.role !== 'admin' ? <Pressable style={activeSection === 'applications' ? styles.navItemActive : styles.navItem} onPress={onNavigateApplications} disabled={!onNavigateApplications}><Text style={styles.navIcon}>▤</Text><Text style={activeSection === 'applications' ? styles.navTextActive : styles.navText}>Applications</Text></Pressable> : null}
            {user?.role === 'admin' ? <Pressable style={activeSection === 'people' ? styles.navItemActive : styles.navItem} onPress={onNavigatePeople} disabled={!onNavigatePeople}><Text style={styles.navIcon}>♙</Text><Text style={activeSection === 'people' ? styles.navTextActive : styles.navText}>People & access</Text></Pressable> : null}
            <View style={styles.sidebarSpacer} />
            <View style={styles.profileBlock}><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{(user?.username || 'U').slice(0, 1).toUpperCase()}</Text></View><View style={styles.profileTextWrap}><Text style={styles.profileName}>{user?.username ?? 'Guest'}</Text><Text style={styles.profileRole}>{roleLabel}</Text></View></View>
            <Pressable style={styles.sidebarSignOut} onPress={onBack}><Text style={styles.sidebarSignOutText}>{backLabel === 'Sign out' ? '↪  Sign out' : '←  ' + backLabel}</Text></Pressable>
          </View>
        ) : null}
        <View style={styles.workspace}>
          <View style={[styles.topBar, compact && styles.topBarCompact]}>
            {compact ? <View style={styles.mobileBrand}><View style={styles.mobileLogo}><Text style={styles.sidebarLogoText}>V</Text></View><Text style={styles.sidebarBrand}>VerifyFlow</Text></View> : <Text style={styles.breadcrumb}>Workspace  /  {backLabel === 'Sign out' ? 'Overview' : backLabel}</Text>}
            <View style={styles.grow} />
            {onRefresh ? <Pressable style={styles.refreshButton} onPress={onRefresh}><Text style={styles.refreshText}>↻  Refresh</Text></Pressable> : null}
            {compact ? <Pressable style={styles.mobileExit} onPress={onBack}><Text style={styles.mobileExitText}>{backLabel}</Text></Pressable> : null}
          </View>
          <ScrollView contentContainerStyle={[styles.page, compact && styles.pageCompact]} keyboardShouldPersistTaps="handled">
            <View style={[styles.content, compact && styles.contentCompact]}>{children}</View>
            <Text style={styles.footer}>VERIFYFLOW  ·  HANDLE CUSTOMER DATA UNDER APPROVED POLICY</Text>
          </ScrollView>
          {compact ? <View style={styles.mobileNav}><View style={styles.mobileNavActive}><Text style={styles.mobileNavIcon}>▦</Text><Text style={styles.mobileNavLabel}>Overview</Text></View><Pressable style={styles.mobileNavItem} onPress={onBack}><Text style={styles.mobileNavIcon}>↪</Text><Text style={styles.mobileNavLabel}>{backLabel === 'Sign out' ? 'Sign out' : 'Back'}</Text></Pressable></View> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function CaseRow({ item, showClientContact = false, onPress }: { item: LoanCase; showClientContact?: boolean; onPress: () => void }) {

  return <Pressable style={styles.caseCard} onPress={onPress}><View style={styles.rowBetween}><Text style={styles.kicker}>{item.reference}</Text><StatusBadge status={item.status} /></View><Text style={styles.caseName}>{item.details.applicant}</Text>{showClientContact ? <Text style={styles.contactText}>{item.details.phone || 'Phone not provided'}  ·  {item.details.email || 'Email not provided'}</Text> : null}<Text style={styles.mutedSmall}>{item.assignee} - {item.documents.length} documents</Text>{item.verification_history.length ? <Text style={styles.historyComment}>{item.verification_history.length} verification update(s) - latest by {item.verified_by}</Text> : null}</Pressable>;

}



function Section({ title, children }: { title: string; children: React.ReactNode }) {

  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;

}



function ChoiceSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {

  const [open, setOpen] = useState(false);

  return <View style={styles.choiceWrap}>

    <Text style={styles.fieldLabel}>{label}</Text>

    <Pressable style={styles.choiceButton} onPress={() => setOpen((current) => !current)} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>

      <Text style={styles.choiceButtonText}>{value}</Text><Text style={styles.choiceChevron}>{open ? '^' : 'v'}</Text>

    </Pressable>

    {open ? <View style={styles.choiceMenu}><ScrollView nestedScrollEnabled style={styles.choiceScroll}>

      {options.map((option) => <Pressable key={option} style={styles.choiceOption} onPress={() => { onChange(option); setOpen(false); }}><Text style={styles.choiceOptionText}>{option}</Text></Pressable>)}

    </ScrollView></View> : null}

  </View>;

}



function Info({ label, value }: { label: string; value: string }) {

  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value || 'Not provided'}</Text></View>;

}



function Field({ label, value, onChangeText, keyboardType, secureTextEntry, autoCapitalize, placeholder }: {

  label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad' | 'number-pad'; secureTextEntry?: boolean; autoCapitalize?: 'none' | 'sentences'; placeholder?: string;

}) {

  return <View style={styles.formField}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType ?? 'default'} secureTextEntry={secureTextEntry} autoCapitalize={autoCapitalize ?? (keyboardType === 'email-address' ? 'none' : 'sentences')} placeholder={placeholder} style={styles.input} /></View>;

}



function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {

  return <Pressable style={[styles.primaryButton, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;

}



function StatusBadge({ status }: { status: CaseStatus }) {

  const tone = status === 'Approved' ? [palette.paleGreen, palette.green] : status === 'Rejected' ? [palette.paleCoral, palette.coral] : status === 'Needs info' ? [palette.paleOrange, palette.orange] : ['#EEF1EE', '#5C6B66'];

  return <View style={[styles.badge, { backgroundColor: tone[0] }]}><Text style={[styles.badgeText, { color: tone[1] }]}>{status}</Text></View>;

}



function EmptyState({ message }: { message: string }) {

  return <View style={styles.empty}><Text style={styles.muted}>{message}</Text></View>;

}



function ErrorText({ children }: { children: React.ReactNode }) {

  return <Text style={styles.error}>{children}</Text>;

}



const palette = {
  ink: '#17233B', muted: '#69758A', line: '#E4E9F1', canvas: '#F4F7FC', white: '#FFFFFF',
  teal: '#365CEB', paleTeal: '#EAF0FF', orange: '#B96A18', paleOrange: '#FFF2DF',
  coral: '#D04444', paleCoral: '#FDECEC', green: '#218653', paleGreen: '#E6F6EB',
};



const styles = StyleSheet.create({
  sidebar: { width: 238, backgroundColor: '#17233B', paddingHorizontal: 18, paddingTop: 28, paddingBottom: 18 },
  sidebarBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 3, marginBottom: 42 },
  sidebarLogo: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#365CEB', alignItems: 'center', justifyContent: 'center' },
  sidebarLogoText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  sidebarBrand: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', letterSpacing: -0.3 },
  sidebarSub: { color: '#9EABC5', fontSize: 8, fontWeight: '800', letterSpacing: 1.1, marginTop: 3 },
  navCaption: { color: '#8B99B5', fontSize: 9, fontWeight: '900', letterSpacing: 1.4, marginBottom: 12, marginLeft: 10 },
  navItemActive: { minHeight: 44, borderRadius: 10, backgroundColor: '#2B3B5B', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12, marginBottom: 5, borderLeftWidth: 3, borderLeftColor: '#6E8AFF' },
  navItem: { minHeight: 44, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 12, marginBottom: 5 },
  navIcon: { color: '#AAB7D0', fontSize: 16, width: 18 }, navTextActive: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' }, navText: { color: '#B4C0D5', fontSize: 12, fontWeight: '700' },
  sidebarSpacer: { flex: 1, minHeight: 40 }, profileBlock: { borderTopWidth: 1, borderTopColor: '#34415D', paddingTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  profileAvatar: { width: 35, height: 35, borderRadius: 12, backgroundColor: '#DCE6FF', alignItems: 'center', justifyContent: 'center' }, profileAvatarText: { color: '#233B75', fontSize: 13, fontWeight: '900' }, profileTextWrap: { flex: 1 }, profileName: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' }, profileRole: { color: '#9EABC5', fontSize: 8, fontWeight: '700', marginTop: 4 },
  sidebarSignOut: { paddingVertical: 14, paddingHorizontal: 6 }, sidebarSignOutText: { color: '#D4DCEE', fontSize: 11, fontWeight: '700' }, workspace: { flex: 1, minWidth: 0 }, breadcrumb: { color: '#7A879D', fontSize: 11, fontWeight: '700' }, mobileBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 }, mobileLogo: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#365CEB', alignItems: 'center', justifyContent: 'center' }, mobileExit: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#EAF0FF' }, mobileExitText: { color: '#365CEB', fontSize: 10, fontWeight: '800' },
  mobileNav: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: palette.line }, mobileNavActive: { alignItems: 'center', gap: 3, paddingHorizontal: 18 }, mobileNavItem: { alignItems: 'center', gap: 3, paddingHorizontal: 18 }, mobileNavIcon: { color: '#365CEB', fontSize: 15, fontWeight: '800' }, mobileNavLabel: { color: '#69758A', fontSize: 9, fontWeight: '800' },

  backgroundImage: { flex: 1, width: '100%' }, loginWash: { flex: 1, backgroundColor: 'rgba(245,247,244,0.12)' },

  safe: { flex: 1, backgroundColor: 'transparent' }, appSafe: { flex: 1, backgroundColor: palette.canvas }, shell: { flex: 1, flexDirection: 'row', backgroundColor: palette.canvas }, shellCompact: { flexDirection: 'column' }, page: { width: '100%', alignItems: 'center', paddingBottom: 30 }, pageCompact: { paddingBottom: 16 },

  content: { width: '100%', maxWidth: 1180, paddingHorizontal: 30, paddingTop: 28 }, contentCompact: { paddingHorizontal: 16, paddingTop: 20 },

  topBar: { width: '100%', minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 30, gap: 12, backgroundColor: palette.white, borderBottomWidth: 1, borderBottomColor: palette.line }, topBarCompact: { minHeight: 58, paddingHorizontal: 16 },

  backLink: { paddingVertical: 9 }, backText: { color: palette.teal, fontSize: 12, fontWeight: '800' },

  refreshButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8, backgroundColor: palette.paleTeal }, refreshText: { color: palette.teal, fontSize: 11, fontWeight: '800' },

  username: { color: palette.muted, fontSize: 11, fontWeight: '700' }, grow: { flex: 1 },

  footer: { width: '100%', maxWidth: 1180, color: '#9AA5B6', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 30, paddingTop: 22, paddingBottom: 16 },

  loginPage: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16, minHeight: '100%' },

  loginBrand: { alignItems: 'center', marginBottom: 18 }, logo: { width: 48, height: 48, borderRadius: 15, backgroundColor: palette.teal, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },

  logoText: { color: palette.white, fontSize: 24, fontWeight: '900' }, brand: { color: palette.ink, fontSize: 15, fontWeight: '900' }, brandSub: { color: palette.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginTop: 4 },

  loginPanel: { width: '100%', maxWidth: 430, backgroundColor: 'rgba(255,255,255,0.97)', borderWidth: 1, borderColor: palette.line, borderRadius: 14, padding: 18 },

  kicker: { color: palette.teal, fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 7 }, pageTitle: { color: palette.ink, fontSize: 29, fontWeight: '900', marginBottom: 6 }, muted: { color: palette.muted, fontSize: 12, lineHeight: 18 }, mutedSmall: { color: palette.muted, fontSize: 10, lineHeight: 16 }, loginFoot: { color: palette.muted, fontSize: 10, lineHeight: 16, textAlign: 'center', marginTop: 14 }, demoFoot: { color: palette.muted, fontSize: 10, lineHeight: 16, textAlign: 'center', maxWidth: 390, marginTop: 18 },

  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }, smallAction: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, backgroundColor: palette.teal }, smallActionText: { color: palette.white, fontSize: 11, fontWeight: '800' },

  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 21 }, metric: { flexGrow: 1, flexBasis: '22%', minWidth: 68, padding: 12, minHeight: 72, borderWidth: 1, borderColor: palette.line, borderRadius: 14, backgroundColor: palette.white }, metricValue: { fontSize: 21, fontWeight: '900', marginBottom: 4 }, metricLabel: { color: palette.muted, fontSize: 9, fontWeight: '700' },

  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }, sectionTitle: { color: palette.ink, fontSize: 14, fontWeight: '900', marginBottom: 10 },

  caseCard: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: 14, padding: 18, marginBottom: 12 }, rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, caseName: { color: palette.ink, fontSize: 16, fontWeight: '800', marginTop: 8, marginBottom: 5 }, contactText: { color: palette.ink, fontSize: 11, fontWeight: '700', marginBottom: 4 },

  badge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 }, badgeText: { fontSize: 10, fontWeight: '800' },

  notice: { padding: 13, borderRadius: 10, backgroundColor: '#E6F2ED', marginTop: 17 }, noticeTitle: { color: palette.ink, fontSize: 13, fontWeight: '800', marginBottom: 4 },

  notificationPanel: { padding: 14, borderRadius: 11, backgroundColor: '#E7F2ED', marginBottom: 20 }, notificationCount: { color: palette.teal, fontSize: 10, fontWeight: '800' }, notificationItem: { paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#D5E5DD' }, notificationReference: { color: palette.ink, fontSize: 12, fontWeight: '900' }, notificationComment: { color: palette.ink, fontSize: 11, lineHeight: 17, marginTop: 7, marginBottom: 4 }, notificationFoot: { color: palette.muted, fontSize: 9, marginTop: 4 },

  section: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: 11, padding: 14, marginBottom: 11 }, infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#EDF1EE' }, infoLabel: { color: palette.muted, fontSize: 11, flex: 0.85 }, infoValue: { color: palette.ink, fontSize: 11, fontWeight: '700', textAlign: 'right', flex: 1.15 },

  documentRow: { color: palette.teal, fontSize: 11, fontWeight: '700', paddingVertical: 7 }, formNotice: { color: palette.muted, fontSize: 11, lineHeight: 17, marginBottom: 13 }, formField: { gap: 5, marginBottom: 11 }, fieldLabel: { color: '#435550', fontSize: 10, fontWeight: '800' }, input: { minHeight: 43, borderWidth: 1, borderColor: palette.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: palette.ink, backgroundColor: palette.white, fontSize: 12 }, multiline: { height: 100, textAlignVertical: 'top', marginTop: 12, marginBottom: 12 },

  uploadButton: { minHeight: 45, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.teal, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }, outlineAction: { alignSelf: 'flex-start', borderWidth: 1, borderColor: palette.teal, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10 }, outlineActionText: { color: palette.teal, fontSize: 11, fontWeight: '800' },

  primaryButton: { minHeight: 43, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 8, backgroundColor: palette.teal, marginTop: 8 }, primaryButtonText: { color: palette.white, fontSize: 11, fontWeight: '900' }, disabled: { opacity: 0.55 },

  rejectButton: { minHeight: 43, minWidth: 90, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E7B8B1', borderRadius: 8, backgroundColor: palette.white }, rejectText: { color: palette.coral, fontSize: 11, fontWeight: '900' }, decisionButtons: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }, reviewPanel: { backgroundColor: '#E9F2EE', borderRadius: 11, padding: 14, marginTop: 15, marginBottom: 10 },

  historyItem: { borderTopWidth: 1, borderTopColor: '#EDF1EE', paddingTop: 11, marginTop: 6 }, historyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, historyComment: { color: palette.ink, fontSize: 11, lineHeight: 17, marginTop: 8 },

  chipList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 11 }, chip: { borderRadius: 18, backgroundColor: '#EEF2EF', paddingHorizontal: 11, paddingVertical: 8 }, chipSelected: { backgroundColor: palette.teal }, chipText: { color: palette.ink, fontSize: 10, fontWeight: '700' }, chipTextSelected: { color: palette.white },

  scheduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, zIndex: 3 }, scheduleCell: { flexGrow: 1, flexBasis: '30%', minWidth: 110 },

  choiceWrap: { position: 'relative', gap: 5 }, choiceButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, borderWidth: 1, borderColor: palette.line, borderRadius: 8, backgroundColor: palette.white }, choiceButtonText: { color: palette.ink, fontSize: 11, fontWeight: '700' }, choiceChevron: { color: palette.teal, fontSize: 12, fontWeight: '900' }, choiceMenu: { position: 'absolute', top: 63, left: 0, right: 0, zIndex: 10, elevation: 10, maxHeight: 180, borderWidth: 1, borderColor: palette.line, borderRadius: 8, backgroundColor: palette.white, shadowColor: '#172C2A', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, choiceScroll: { maxHeight: 178 }, choiceOption: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#EDF1EE' }, choiceOptionText: { color: palette.ink, fontSize: 11 },

  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#EDF1EE' }, staffRowSelected: { backgroundColor: '#E9F2EE', borderRadius: 10, paddingHorizontal: 8 }, staffAvatar: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, employeeAvatar: { backgroundColor: '#DCEFE9' }, clientAvatar: { backgroundColor: '#F8E7D5' }, staffAvatarText: { color: palette.ink, fontSize: 11, fontWeight: '900' }, staffDetails: { flex: 1 }, staffName: { color: palette.ink, fontSize: 12, fontWeight: '800', marginBottom: 3 }, manageLink: { color: palette.teal, fontSize: 10, fontWeight: '800' }, accountEditor: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: 11, padding: 14, marginBottom: 12 }, separator: { height: 1, backgroundColor: palette.line, marginVertical: 14 }, error: { color: '#AE3C32', fontSize: 11, lineHeight: 16, marginVertical: 8 }, empty: { padding: 18, borderRadius: 14, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line },

});