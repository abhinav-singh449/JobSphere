// ════════════════════════════════════════════
//  JobSphere — script.js
//  Works on both user.html and company.html
// ════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth, signInWithPopup, GoogleAuthProvider,
    signInWithEmailAndPassword, createUserWithEmailAndPassword,
    sendPasswordResetEmail, signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, collection, addDoc, getDocs, getDoc,
    setDoc, doc, query, where, orderBy, serverTimestamp,
    onSnapshot, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ── Firebase Config ──────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyAD3xg3SZLQyv-Rf3rb4vw6-HVsZuZRD3E",
    authDomain: "jobsphere-ab925.firebaseapp.com",
    projectId: "jobsphere-ab925",
    storageBucket: "jobsphere-ab925.firebasestorage.app",
    messagingSenderId: "757724057808",
    appId: "1:757724057808:web:d46c8fbb78409abfef4ed5"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const provider = new GoogleAuthProvider();

// Cloudinary
const CLOUDINARY = { cloudName: 'dsv4npqz3', uploadPreset: 'jobsphere_media' };

// Current page
const PAGE = document.body.getAttribute('data-page'); // 'user' or 'company'
const PROTECTED_MODAL_ACTIONS = {
    applyModal: 'apply for jobs',
    postJobModal: 'post jobs',
    uploadModal: 'create posts'
};

// Track active chat listener so we can unsubscribe
let activeChatUnsub = null;

function requireAuthenticatedUser(action = 'continue') {
    const user = auth.currentUser;
    if (user) return user;

    showNotification(`Please sign in to ${action}.`, 'info');
    if (typeof window.openModal === 'function') {
        window.openModal('authModal');
    }
    return null;
}

async function requireOwnedJob(jobId, userId) {
    const jobSnap = await getDoc(doc(db, 'jobs', jobId));
    if (!jobSnap.exists()) {
        showNotification('This job is no longer available.', 'error');
        return null;
    }

    const job = jobSnap.data();
    if (job.postedBy !== userId) {
        showNotification('You can only manage jobs posted from your account.', 'error');
        return null;
    }

    return job;
}

async function requireOwnedApplication(appId, userId) {
    const appSnap = await getDoc(doc(db, 'applications', appId));
    if (!appSnap.exists()) {
        showNotification('This application could not be found.', 'error');
        return null;
    }

    const application = appSnap.data();
    if (application.companyUid !== userId) {
        showNotification('You can only review applications for your own jobs.', 'error');
        return null;
    }

    return application;
}

// ════════════════════════════════════════════
//  AUTH STATE
// ════════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Ensure user doc exists and validate role
        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);
        const currentRole = PAGE === 'company' ? 'company' : 'user';

        if (snap.exists()) {
            // Validate user's role matches current page
            const existingRole = snap.data().role;
            if (existingRole !== currentRole) {
                // User is on wrong page for their role - sign them out
                await signOut(auth);
                showNotification(`This account is registered as ${existingRole}. Please sign in from the ${existingRole} page.`, 'error');
                return;
            }
        } else {
            // New user - create their doc with current role
            await setDoc(userRef, {
                uid: user.uid,
                name: user.displayName || user.email.split('@')[0],
                email: user.email,
                photo: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||'User')}&background=6366f1&color=fff`,
                role: currentRole,
                createdAt: serverTimestamp()
            });
        }
        updateNavForUser(user);
        if (PAGE === 'user') {
            loadJobsFromFirestore();
            loadUserApplications(user.uid);
            loadPosts();
        } else if (PAGE === 'company') {
            loadCompanyJobs(user.uid);
            loadCompanyApplications(user.uid);
            loadPosts();
        }
        // Load network data on both pages
        loadMyConnections(user.uid);
        loadPendingRequests(user.uid);
        loadSentRequests(user.uid);
    } else {
        updateNavForUser(null);
        if (PAGE === 'user') loadJobsFromFirestore();
        loadPosts();
    }
});

// ════════════════════════════════════════════
//  INIT AOS ON LOAD
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    AOS.init({ duration: 1000, once: true, offset: 50 });
    initCounters();
});

// ════════════════════════════════════════════
//  NAVBAR
// ════════════════════════════════════════════
function updateNavForUser(user) {
    const authButtons = document.querySelector('.auth-buttons');
    if (!authButtons) return;

    if (user) {
        const photo = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||'User')}&background=6366f1&color=fff`;
        const name  = user.displayName || user.email.split('@')[0];
        const badge = PAGE === 'company'
            ? `<span style="padding:4px 12px;background:rgba(167,139,250,0.15);color:#7c3aed;border-radius:20px;font-size:0.75rem;font-weight:700;">Company</span>`
            : `<span style="padding:4px 12px;background:rgba(99,102,241,0.15);color:#6366f1;border-radius:20px;font-size:0.75rem;font-weight:700;">Job Seeker</span>`;

        const extraBtn = PAGE === 'company'
            ? `<button class="btn btn-gradient" onclick="openPostJobModal()"><i class="ph ph-plus"></i> Post Job</button>`
            : '';

        authButtons.innerHTML = `
            <button class="switch-role-btn" onclick="switchRole()">
                <i class="ph ph-arrows-left-right"></i> Switch Role
            </button>
            ${badge}
            <div class="user-menu">
                <img src="${photo}" alt="${name}" class="user-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff'">
                <div class="user-dropdown">
                    <div class="user-info">
                        <img src="${photo}" alt="${name}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff'">
                        <strong>${name}</strong>
                        <small>${user.email}</small>
                    </div>
                    <div class="dropdown-divider"></div>
                    ${PAGE === 'user' ? `<a href="#" onclick="openEditProfileModal()"><i class="ph ph-user-circle" style="margin-right:8px;"></i>Edit My Profile</a><a href="#" onclick="openModal('uploadModal')"><i class="ph ph-pencil-line" style="margin-right:8px;"></i>Create Post</a>` : ''}
                    ${PAGE === 'company' ? `<a href="#" onclick="openPostJobModal()"><i class="ph ph-briefcase" style="margin-right:8px;"></i>Post a Job</a><a href="#" onclick="openModal('uploadModal')"><i class="ph ph-pencil-line" style="margin-right:8px;"></i>Create Post</a>` : ''}
                    <div class="dropdown-divider"></div>
                    <a href="#" onclick="googleSignOut()"><i class="ph ph-sign-out" style="margin-right:8px;"></i>Sign Out</a>
                </div>
            </div>
            ${extraBtn}
        `;
    } else {
        const postBtn = PAGE === 'company'
            ? `<button class="btn btn-gradient" onclick="openPostJobModal()"><i class="ph ph-plus"></i> Post Job</button>`
            : '';
        authButtons.innerHTML = `
            <button class="switch-role-btn" onclick="switchRole()">
                <i class="ph ph-arrows-left-right"></i> Switch Role
            </button>
            <button class="btn btn-outline login-btn" onclick="openModal('authModal')">Sign In</button>
            ${postBtn}
        `;
    }
}

// ════════════════════════════════════════════
//  ROLE / NAVIGATION
// ════════════════════════════════════════════
window.switchRole = function() {
    localStorage.removeItem('jobsphere_role');
    window.location.href = 'index.html';
};

// ════════════════════════════════════════════
//  AUTH — Google
// ════════════════════════════════════════════
window.googleSignIn = async function() {
    try {
        provider.setCustomParameters({ prompt: 'select_account' });
        const btn = document.querySelector('.google-btn');
        if (btn) { btn.innerHTML = '<i class="ph ph-spinner"></i> Connecting...'; btn.disabled = true; }

        const result = await signInWithPopup(auth, provider);
        const user   = result.user;
        const currentRole = PAGE === 'company' ? 'company' : 'user';

        const userRef = doc(db, "users", user.uid);
        const snap    = await getDoc(userRef);
        if (!snap.exists()) {
            // New user - check if email exists with different role
            const emailQuery = await getDocs(query(collection(db, "users"), where("email", "==", user.email)));
            if (!emailQuery.empty) {
                const existingRole = emailQuery.docs[0].data().role;
                if (existingRole !== currentRole) {
                    await signOut(auth);
                    showNotification(`This email is already registered as ${existingRole}. Please use a different email or sign in as ${existingRole}.`, 'error');
                    return;
                }
            }
            await setDoc(userRef, {
                uid: user.uid, name: user.displayName,
                email: user.email, photo: user.photoURL,
                role: currentRole,
                createdAt: serverTimestamp()
            });
            showNotification('Welcome to JobSphere!', 'success');
        } else {
            // Existing user - verify role matches
            const existingRole = snap.data().role;
            if (existingRole !== currentRole) {
                await signOut(auth);
                showNotification(`This account is registered as ${existingRole}. Please sign in from the ${existingRole} page.`, 'error');
                return;
            }
            showNotification(`Welcome back, ${user.displayName}!`, 'success');
        }
        closeModal('authModal');
    } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
            showNotification(err.message, 'error');
        }
    } finally {
        const btn = document.querySelector('.google-btn');
        if (btn) {
            btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Continue with Google`;
            btn.disabled = false;
        }
    }
};

// ── Email Sign In ──
window.handleSignIn = async function(e) {
    e.preventDefault();
    const email = document.getElementById('signinEmail').value;
    const pass  = document.getElementById('signinPassword').value;
    const btn   = e.target.querySelector('button[type="submit"]');
    const currentRole = PAGE === 'company' ? 'company' : 'user';
    btn.textContent = 'Signing In...'; btn.disabled = true;
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, pass);
        // Check role in Firestore
        const userRef = doc(db, "users", userCredential.user.uid);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
            const existingRole = snap.data().role;
            if (existingRole !== currentRole) {
                await signOut(auth);
                showNotification(`This account is registered as ${existingRole}. Please sign in from the ${existingRole} page.`, 'error');
                return;
            }
        }
        showNotification('Signed in successfully!', 'success');
        closeModal('authModal');
    } catch (err) {
        showNotification(err.code === 'auth/invalid-credential' ? 'Invalid email or password.' : err.message, 'error');
    } finally { btn.textContent = 'Sign In'; btn.disabled = false; }
};

// ── Email Sign Up ──
window.handleSignUp = async function(e) {
    e.preventDefault();
    const name  = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const pass  = document.getElementById('signupPassword').value;
    const btn   = e.target.querySelector('button[type="submit"]');
    const currentRole = PAGE === 'company' ? 'company' : 'user';
    if (pass.length < 6) { showNotification('Password must be at least 6 characters', 'error'); return; }
    btn.textContent = 'Creating...'; btn.disabled = true;
    try {
        // Check if email already exists with different role
        const emailQuery = await getDocs(query(collection(db, "users"), where("email", "==", email)));
        if (!emailQuery.empty) {
            const existingRole = emailQuery.docs[0].data().role;
            if (existingRole !== currentRole) {
                showNotification(`This email is already registered as ${existingRole}. Please use a different email or sign in as ${existingRole}.`, 'error');
                btn.textContent = 'Create Account'; btn.disabled = false;
                return;
            }
        }
        const result = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(result.user, { displayName: name });
        await setDoc(doc(db, "users", result.user.uid), {
            uid: result.user.uid, name, email,
            photo: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`,
            role: currentRole,
            createdAt: serverTimestamp()
        });
        showNotification('Account created! Welcome!', 'success');
        closeModal('authModal');
    } catch (err) {
        showNotification(err.code === 'auth/email-already-in-use' ? 'Email already in use.' : err.message, 'error');
    } finally { btn.textContent = 'Create Account'; btn.disabled = false; }
};

// ── Forgot Password ──
window.showForgotPassword = function() { closeModal('authModal'); openModal('forgotPasswordModal'); };
window.handleForgotPassword = async function(e) {
    e.preventDefault();
    const email = document.getElementById('forgotEmail').value;
    const btn   = e.target.querySelector('button[type="submit"]');
    btn.textContent = 'Sending...'; btn.disabled = true;
    try {
        await sendPasswordResetEmail(auth, email);
        showNotification('Reset email sent! Check your inbox.', 'success');
        closeModal('forgotPasswordModal');
    } catch (err) {
        showNotification(err.message, 'error');
    } finally { btn.textContent = 'Send Reset Link'; btn.disabled = false; }
};

// ── Toggle Auth Mode ──
window.toggleAuthMode = function(mode) {
    document.getElementById('signinForm').style.display  = mode === 'signin' ? 'block' : 'none';
    document.getElementById('signupForm').style.display  = mode === 'signup' ? 'block' : 'none';
    document.getElementById('signinToggle').classList.toggle('active', mode === 'signin');
    document.getElementById('signupToggle').classList.toggle('active', mode === 'signup');
    document.getElementById('authModalTitle').textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
};

// ── Sign Out ──
window.googleSignOut = async function() {
    await signOut(auth);
    localStorage.removeItem('jobsphere_role');
    window.location.href = 'index.html';
};

// ════════════════════════════════════════════
//  JOBS — LOAD (user.html)
// ════════════════════════════════════════════
async function loadJobsFromFirestore() {
    const container = document.getElementById('job-list-container');
    if (!container) return;
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--gray);"><i class="ph ph-spinner" style="font-size:2rem;"></i><p style="margin-top:10px;">Loading jobs...</p></div>`;
    try {
        const snap = await getDocs(query(collection(db, "jobs"), orderBy("postedAt", "desc")));
        if (snap.empty) { container.innerHTML = getSampleJobsHTML(); return; }
        container.innerHTML = '';
        snap.forEach(d => {
            const job = d.data();
            container.innerHTML += buildJobCard(d.id, job);
        });
    } catch (e) {
        container.innerHTML = getSampleJobsHTML();
    }
}

function buildJobCard(id, job) {
    return `
        <div class="job-card" data-title="${job.title}" data-job-id="${id}">
            <div class="company-logo"><i class="ph-fill ph-buildings"></i></div>
            <div class="job-main">
                <h3>${job.title}</h3>
                <div class="job-tags">
                    <span><i class="ph-fill ph-map-pin"></i> ${job.location}</span>
                    <span><i class="ph-fill ph-buildings"></i> ${job.company}</span>
                </div>
                <p style="color:var(--gray);margin-top:10px;font-size:0.95rem;">${(job.description||'').substring(0,120)}...</p>
            </div>
            <div class="job-right">
                <span class="salary-range">${job.salary}</span>
                <button class="btn btn-gradient apply-btn" onclick="openApplyModal('${id}','${job.title.replace(/'/g,"\\'")}','${(job.postedBy||'')}')">Apply Now</button>
            </div>
        </div>`;
}

function getSampleJobsHTML() {
    return `
        <div class="job-card" data-title="Product Designer">
            <div class="company-logo" style="color:var(--accent);"><i class="ph-fill ph-dribbble-logo"></i></div>
            <div class="job-main"><h3>Senior Product Designer</h3><div class="job-tags"><span><i class="ph-fill ph-map-pin"></i> Remote</span><span><i class="ph-fill ph-clock"></i> Full Time</span></div><p style="color:var(--gray);margin-top:10px;font-size:0.95rem;">Join our design team to shape the future of digital experiences for millions of users worldwide.</p></div>
            <div class="job-right"><span class="salary-range">$120k - $140k</span><button class="btn btn-gradient apply-btn" onclick="openApplyModal('sample1','Senior Product Designer','')">Apply Now</button></div>
        </div>
        <div class="job-card" data-title="Frontend Developer">
            <div class="company-logo" style="color:#3b82f6;"><i class="ph-fill ph-code"></i></div>
            <div class="job-main"><h3>Frontend Developer (React)</h3><div class="job-tags"><span><i class="ph-fill ph-map-pin"></i> New York, USA</span><span><i class="ph-fill ph-clock"></i> Contract</span></div><p style="color:var(--gray);margin-top:10px;font-size:0.95rem;">Build cutting-edge web applications with modern React, TypeScript, and Next.js stack.</p></div>
            <div class="job-right"><span class="salary-range">$90k - $110k</span><button class="btn btn-gradient apply-btn" onclick="openApplyModal('sample2','Frontend Developer','')">Apply Now</button></div>
        </div>`;
}

// ════════════════════════════════════════════
//  APPLY FOR JOB (user.html)
// ════════════════════════════════════════════
window.openApplyModal = async function(jobId, title, companyUid) {
    const user = requireAuthenticatedUser('apply for jobs');
    if (!user) return;

    document.getElementById('modalTitle').textContent = `Apply for: ${title}`;
    document.getElementById('applicantName').value  = user.displayName || '';
    document.getElementById('applicantEmail').value = user.email || '';
    window._applyJobId     = jobId;
    window._applyJobTitle  = title;
    window._applyCompanyUid = companyUid;

    // Load profile preview inside apply modal
    try {
        const profSnap = await getDoc(doc(db, "userProfiles", user.uid));
        const preview = document.getElementById('apply-profile-preview');
        if (profSnap.exists()) {
            const p = profSnap.data();
            document.getElementById('apply-profile-photo').src = p.photoUrl || user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||'User')}&background=6366f1&color=fff`;
            document.getElementById('apply-profile-name').textContent = p.fullName || user.displayName || '';
            document.getElementById('apply-profile-title').textContent = p.jobTitle || 'No job title set';
            if (preview) preview.style.display = 'flex';
            // Pre-fill resume if already uploaded in profile
            if (p.resumeUrl) {
                const label = document.getElementById('resume-upload-label');
                if (label) label.innerHTML = `<i class="ph ph-check-circle" style="color:#059669;margin-right:6px;"></i>Resume from profile: ${p.resumeFileName || 'resume.pdf'} — <a href="${p.resumeUrl}" target="_blank" style="color:#059669;">Preview</a>`;
                window._profileResumeUrl = p.resumeUrl;
                window._profileResumeFileName = p.resumeFileName || 'resume.pdf';
            }
        } else {
            if (preview) preview.style.display = 'none';
        }
    } catch(e) { console.error('Profile preview error:', e); }

    openModal('applyModal');
};

window.handleApply = async function(e) {
    e.preventDefault();
    const user = requireAuthenticatedUser('apply for jobs');
    if (!user) return;

    const resumeFile = document.getElementById('applyResume')?.files[0];
    if (!resumeFile) {
        showNotification('Please upload your resume before applying.', 'error');
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.textContent = 'Uploading resume...'; btn.disabled = true;

    try {
        // Upload resume to Cloudinary
        const formData = new FormData();
        formData.append('file', resumeFile);
        formData.append('upload_preset', CLOUDINARY.uploadPreset);
        const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/auto/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        const resumeUrl = data.secure_url;

        btn.textContent = 'Submitting...';
        await addDoc(collection(db, "applications"), {
            jobId:          window._applyJobId || 'unknown',
            jobTitle:       window._applyJobTitle || 'Unknown',
            companyUid:     window._applyCompanyUid || '',
            applicantUid:   user.uid,
            applicantName:  document.getElementById('applicantName').value,
            applicantEmail: document.getElementById('applicantEmail').value,
            applicantPhoto: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||'User')}&background=6366f1&color=fff`,
            coverLetter:    document.getElementById('coverLetter')?.value || '',
            resumeUrl,
            resumeFileName: resumeFile.name,
            status:         'pending',
            appliedAt:      serverTimestamp()
        });
        btn.innerHTML = '<i class="ph ph-check-circle"></i> Sent!';
        btn.style.background = 'var(--success)';
        setTimeout(() => {
            closeModal('applyModal');
            e.target.reset();
            document.getElementById('resume-upload-label').textContent = 'Click to upload your resume (PDF, DOC, DOCX)';
            btn.textContent = 'Submit Application';
            btn.style.background = ''; btn.disabled = false;
            showNotification('Application submitted!', 'success');
            loadUserApplications(user.uid);
        }, 1200);
    } catch (err) {
        showNotification('Failed to submit: ' + err.message, 'error');
        btn.textContent = 'Submit Application'; btn.disabled = false;
    }
};

// Preview resume file name in apply modal
window.previewResumeFile = function(input) {
    const label = document.getElementById('resume-upload-label');
    if (input.files && input.files[0]) {
        label.innerHTML = `<i class="ph ph-check-circle" style="color:#059669;margin-right:6px;"></i>${input.files[0].name}`;
    }
};

// Preview profile photo in edit modal
window.previewProfilePhoto = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('profilePhotoPreview').src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// Preview resume file in profile modal
window.previewProfileResume = function(input) {
    const label = document.getElementById('profile-resume-label');
    if (input.files && input.files[0]) {
        label.innerHTML = `<i class="ph ph-check-circle" style="color:#059669;margin-right:6px;"></i>${input.files[0].name} — ready to upload`;
    }
};

// ════════════════════════════════════════════
//  USER — MY APPLICATIONS (real-time)
// ════════════════════════════════════════════
function loadUserApplications(uid) {
    const container = document.getElementById('user-applications-list');
    if (!container) return;

    const q = query(collection(db, "applications"), where("applicantUid","==", uid));
    onSnapshot(q, (snap) => {
        if (snap.empty) {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);"><i class="ph ph-file-text" style="font-size:4rem;margin-bottom:20px;display:block;opacity:0.4;"></i><p>You haven't applied to any jobs yet.</p></div>`;
            return;
        }
        const sortedApps = snap.docs.sort((a,b) => (b.data().appliedAt?.toMillis?.() || 0) - (a.data().appliedAt?.toMillis?.() || 0));
        container.innerHTML = '';
        sortedApps.forEach(d => {
            const app = d.data();
            const appId = d.id;
            const statusBadge = getStatusBadge(app.status);
            const chatBtn = app.status === 'accepted'
                ? `<button class="chat-open-btn" onclick="openChat('${appId}','${app.jobTitle.replace(/'/g,"\\'")}','${app.companyUid}','company')">
                       <i class="ph ph-chat-circle-dots"></i> Chat with Company
                   </button>`
                : '';
            container.innerHTML += `
                <div class="application-card">
                    <div class="job-icon"><i class="ph-fill ph-buildings"></i></div>
                    <div class="app-info">
                        <h4>${app.jobTitle}</h4>
                        <p>Applied ${formatTimeAgo(app.appliedAt)}</p>
                        ${app.coverLetter ? `<p style="margin-top:6px;font-size:0.82rem;color:var(--gray);">"${app.coverLetter.substring(0,80)}..."</p>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;">
                        ${statusBadge}
                        ${chatBtn}
                    </div>
                </div>`;
        });
    });
}

// ════════════════════════════════════════════
//  COMPANY — POST JOB
// ════════════════════════════════════════════
window.openPostJobModal = function() {
    const user = requireAuthenticatedUser('post jobs');
    if (!user) return;

    openModal('postJobModal');
};

window.handleJobPost = async function(e) {
    e.preventDefault();
    const user = requireAuthenticatedUser('post jobs');
    if (!user) return;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.textContent = 'Posting...'; btn.disabled = true;

    try {
        await addDoc(collection(db, "jobs"), {
            title:       document.getElementById('jobTitle').value,
            company:     document.getElementById('jobCompany').value,
            location:    document.getElementById('jobLocation').value,
            salary:      document.getElementById('jobSalary').value,
            description: document.getElementById('jobDescription').value,
            postedBy:    user.uid,
            postedByName: user.displayName || user.email,
            postedAt:    serverTimestamp()
        });
        closeModal('postJobModal');
        e.target.reset();
        showNotification('Job posted successfully!', 'success');
        loadCompanyJobs(user.uid);
    } catch (err) {
        showNotification('Failed to post job.', 'error');
    } finally { btn.textContent = 'Post Job Now'; btn.disabled = false; }
};

// ════════════════════════════════════════════
//  COMPANY — MY POSTED JOBS (real-time)
// ════════════════════════════════════════════
function loadCompanyJobs(uid) {
    const container = document.getElementById('company-jobs-container');
    if (!container) return;

    const q = query(collection(db, "jobs"), where("postedBy","==",uid));
    onSnapshot(q, (snap) => {
        if (snap.empty) {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);"><i class="ph ph-briefcase" style="font-size:4rem;margin-bottom:20px;display:block;opacity:0.4;"></i><h3 style="color:var(--dark);margin-bottom:10px;">No Jobs Posted Yet</h3><button class="btn btn-gradient" onclick="openPostJobModal()">Post Your First Job</button></div>`;
            return;
        }
        const sortedJobs = snap.docs.sort((a,b) => (b.data().postedAt?.toMillis?.() || 0) - (a.data().postedAt?.toMillis?.() || 0));
        container.innerHTML = '';
        sortedJobs.forEach(d => {
            const job = d.data();
            container.innerHTML += `
                <div class="posted-job-card">
                    <div class="job-icon"><i class="ph-fill ph-briefcase"></i></div>
                    <div class="pj-info">
                        <h4>${job.title}</h4>
                        <p><i class="ph ph-map-pin"></i> ${job.location} &nbsp;·&nbsp; <i class="ph ph-currency-dollar"></i> ${job.salary}</p>
                        <p style="margin-top:4px;font-size:0.8rem;color:var(--gray);">Posted ${formatTimeAgo(job.postedAt)}</p>
                    </div>
                    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                        <span class="applicant-count" id="count-${d.id}"><i class="ph ph-users"></i> Loading...</span>
                        <button onclick="deleteJob('${d.id}')" style="padding:8px 14px;border-radius:20px;border:none;background:rgba(239,68,68,0.1);color:#dc2626;font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;">
                            <i class="ph ph-trash"></i> Delete
                        </button>
                    </div>
                </div>`;
            countApplications(d.id);
        });
    });
}

async function countApplications(jobId) {
    const el = document.getElementById(`count-${jobId}`);
    if (!el) return;
    const snap = await getDocs(query(collection(db, "applications"), where("jobId","==",jobId)));
    el.innerHTML = `<i class="ph ph-users"></i> ${snap.size} Applicant${snap.size !== 1 ? 's' : ''}`;
}

window.deleteJob = async function(jobId) {
    const user = requireAuthenticatedUser('delete jobs');
    if (!user) return;

    try {
        const job = await requireOwnedJob(jobId, user.uid);
        if (!job) return;
        if (!confirm(`Delete "${job.title}"? This cannot be undone.`)) return;

        await deleteDoc(doc(db, "jobs", jobId));
        showNotification('Job deleted.', 'success');
    } catch (e) { showNotification('Failed to delete.', 'error'); }
};

// ════════════════════════════════════════════
//  COMPANY — APPLICATIONS RECEIVED (real-time)
// ════════════════════════════════════════════
function loadCompanyApplications(uid) {
    const container = document.getElementById('company-applications-container');
    if (!container) return;

    const q = query(collection(db, "applications"), where("companyUid","==",uid));
    onSnapshot(q, (snap) => {
        if (snap.empty) {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);"><i class="ph ph-file-text" style="font-size:4rem;margin-bottom:20px;display:block;opacity:0.4;"></i><p>No applications yet. Post a job to receive applications.</p></div>`;
            return;
        }
        const sortedCompanyApps = snap.docs.sort((a,b) => (b.data().appliedAt?.toMillis?.() || 0) - (a.data().appliedAt?.toMillis?.() || 0));
        container.innerHTML = '';
        sortedCompanyApps.forEach(d => {
            const app = d.data();
            const appId = d.id;
            const statusBadge = getStatusBadge(app.status);

            const actionBtns = app.status === 'pending'
                ? `<button class="btn-accept" onclick="updateApplicationStatus('${appId}','accepted','${app.applicantUid}')"><i class="ph ph-check"></i> Accept</button>
                   <button class="btn-reject" onclick="updateApplicationStatus('${appId}','rejected','${app.applicantUid}')"><i class="ph ph-x"></i> Reject</button>`
                : '';

            const chatBtn = app.status === 'accepted'
                ? `<button class="chat-open-btn" onclick="openChat('${appId}','${app.jobTitle.replace(/'/g,"\\'")}','${app.applicantUid}','user')">
                       <i class="ph ph-chat-circle-dots"></i> Chat with Applicant
                   </button>`
                : '';

            container.innerHTML += `
                <div class="app-card">
                    <div class="app-card-top">
                        <img class="app-avatar" src="${app.applicantPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(app.applicantName)}&background=6366f1&color=fff`}" alt="${app.applicantName}" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                        <div class="app-info">
                            <h4>${app.applicantName}</h4>
                            <p>${app.applicantEmail} &nbsp;·&nbsp; Applied for <strong>${app.jobTitle}</strong> &nbsp;·&nbsp; ${formatTimeAgo(app.appliedAt)}</p>
                            ${app.resumeUrl ? `<a href="${app.resumeUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:5px 12px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:20px;color:#059669;font-size:0.8rem;font-weight:600;text-decoration:none;"><i class="ph-fill ph-file-pdf"></i>${app.resumeFileName||'View Resume'} <i class="ph ph-arrow-square-out"></i></a>` : '<span style="display:inline-block;margin-top:6px;font-size:0.8rem;color:#94a3b8;">No resume uploaded</span>'}
                        </div>
                        <div class="app-actions">
                            ${statusBadge}
                            ${actionBtns}
                            ${chatBtn}
                        </div>
                    </div>
                    ${app.coverLetter ? `<div class="cover-letter-text"><strong>Cover Letter:</strong> ${app.coverLetter}</div>` : ''}
                </div>`;
        });
    });
}

// ── Accept / Reject ──
window.updateApplicationStatus = async function(appId, status, applicantUid) {
    try {
        const user = requireAuthenticatedUser('review applications');
        if (!user) return;

        const application = await requireOwnedApplication(appId, user.uid);
        if (!application) return;

        await updateDoc(doc(db, "applications", appId), {
            status,
            reviewedAt: serverTimestamp()
        });
        const msg = status === 'accepted'
            ? '✅ Application accepted! Chat is now unlocked.'
            : '❌ Application rejected.';
        showNotification(msg, status === 'accepted' ? 'success' : 'info');
    } catch (e) { showNotification('Failed to update status.', 'error'); }
};

// ════════════════════════════════════════════
//  REAL-TIME CHAT
//  chatId = applicationId (same for both sides)
//  otherUid = uid of person you're chatting with
//  otherRole = 'company' or 'user' (who you're talking to)
// ════════════════════════════════════════════
window.openChat = function(chatId, jobTitle, otherUid, otherRole) {
    const user = requireAuthenticatedUser('chat');
    if (!user) return;

    // Remove existing chat if open
    closeChat();

    // Store current user uid for reliable comparison in chat
    window._chatCurrentUid = user.uid;

    // Get other person's info
    getDoc(doc(db, "users", otherUid)).then(snap => {
        const other = snap.exists() ? snap.data() : { name: 'Unknown', photo: '' };
        renderChatBox(chatId, `Re: ${jobTitle}`, other, user);
        subscribeToChatMessages(chatId, user.uid);
    });
};

function renderChatBox(chatId, chatLabel, other, me) {
    const container = document.getElementById('chat-container');
    const photo = other.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(other.name||'?')}&background=6366f1&color=fff`;

    container.innerHTML = `
        <div class="chat-modal-overlay" id="chat-overlay">
            <div class="chat-box">
                <div class="chat-header">
                    <img src="${photo}" alt="${other.name}" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                    <div>
                        <h4>${other.name || 'User'}</h4>
                        <small>${chatLabel}</small>
                    </div>
                    <button class="close-chat" onclick="closeChat()"><i class="ph ph-x"></i></button>
                </div>
                <div class="chat-messages" id="chat-messages">
                    <div style="text-align:center;color:#94a3b8;font-size:0.85rem;padding:20px 0;">
                        <i class="ph ph-chat-circle-dots" style="font-size:2rem;display:block;margin-bottom:8px;"></i>
                        Start the conversation!
                    </div>
                </div>
                <div class="chat-input-row">
                    <input type="text" id="chat-input" placeholder="Type a message..." onkeydown="if(event.key==='Enter') sendMessage('${chatId}')">
                    <button class="chat-send-btn" onclick="sendMessage('${chatId}')"><i class="ph ph-paper-plane-tilt"></i></button>
                </div>
            </div>
        </div>`;

    // Store chatId for later
    window._activeChatId = chatId;
    window._activeChatMyUid = me.uid;
}

function subscribeToChatMessages(chatId, myUid) {
    if (activeChatUnsub) activeChatUnsub();
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("sentAt", "asc"));
    activeChatUnsub = onSnapshot(q, (snap) => {
        const container = document.getElementById('chat-messages');
        if (!container) return;
        container.innerHTML = '';
        if (snap.empty) {
            container.innerHTML = `<div style="text-align:center;color:#94a3b8;font-size:0.85rem;padding:20px 0;"><i class="ph ph-chat-circle-dots" style="font-size:2rem;display:block;margin-bottom:8px;"></i>Start the conversation!</div>`;
            return;
        }
        // Use the stored uid for reliable comparison
        const currentUid = window._chatCurrentUid || myUid;
        snap.forEach(d => {
            const msg = d.data();
            const isMine = msg.senderUid === currentUid;
            const time = msg.sentAt ? formatTimeAgo(msg.sentAt) : 'just now';
            const senderLabel = isMine ? 'You' : (msg.senderName || 'Them');
            container.innerHTML += `
                <div class="chat-msg ${isMine ? 'sent' : 'received'}">
                    <div class="msg-sender">${senderLabel}</div>
                    <div>${msg.text}</div>
                    <div class="msg-time">${time}</div>
                </div>`;
        });
        container.scrollTop = container.scrollHeight;
    });
}

window.sendMessage = async function(chatId) {
    const user  = requireAuthenticatedUser('send messages');
    const input = document.getElementById('chat-input');
    if (!user || !input || !input.value.trim()) return;

    const text = input.value.trim();
    input.value = '';
    try {
        await addDoc(collection(db, "chats", chatId, "messages"), {
            text,
            senderUid:  user.uid,
            senderName: user.displayName || user.email,
            sentAt:     serverTimestamp()
        });
        // Update chat metadata
        await setDoc(doc(db, "chats", chatId), {
            lastMessage: text,
            lastMessageAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });
    } catch (e) {
        showNotification('Failed to send message.', 'error');
    }
};

window.closeChat = function() {
    if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
    const container = document.getElementById('chat-container');
    if (container) container.innerHTML = '';
};

// ════════════════════════════════════════════
//  POSTS FEED
// ════════════════════════════════════════════
async function loadPosts() {
    const container = document.getElementById('posts-feed');
    if (!container) return;
    try {
        const snap = await getDocs(query(collection(db, "posts"), orderBy("createdAt","desc")));
        if (snap.empty) {
            container.innerHTML = `<p style="color:var(--gray);text-align:center;padding:40px;">No posts yet. Be the first to share!</p>`;
            return;
        }
        container.innerHTML = '';
        const currentUser = auth.currentUser;

        snap.forEach(d => {
            const p = d.data();
            if (p.deleted) return;

            const postId = d.id;
            const timeAgo = formatPostTime(p.createdAt?.toDate() || new Date());
            const isLiked = currentUser && p.likes && p.likes.includes(currentUser.uid);
            const likeCount = p.likes ? p.likes.length : 0;
            const commentCount = p.commentCount || 0;

            container.innerHTML += `
                <div class="post-card" data-post-id="${postId}" style="background:white;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">
                    <div style="display:flex;align-items:center;gap:14px;padding:20px 20px 16px;">
                        <img style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--primary);cursor:pointer;"
                             src="${p.authorPhoto || 'https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'}"
                             onclick="viewUserProfile('${p.authorId}')"
                             onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                        <div style="flex:1;">
                            <div style="font-weight:700;font-size:1rem;color:var(--dark);cursor:pointer;" onclick="viewUserProfile('${p.authorId}')">${p.authorName || 'Unknown'}</div>
                            <div style="font-size:0.8rem;color:var(--gray);display:flex;align-items:center;gap:4px;"><i class="ph ph-clock"></i> ${timeAgo}</div>
                        </div>
                    </div>
                    <div style="padding:0 20px 16px;font-size:1rem;line-height:1.7;color:var(--dark);white-space:pre-wrap;word-break:break-word;">${escapeHtml(p.content)}</div>
                    ${p.imageUrl ? `<img style="width:100%;max-height:500px;object-fit:cover;cursor:pointer;" src="${p.imageUrl}" onclick="viewPostImage('${p.imageUrl}')" alt="Post image">` : ''}
                    <div style="display:flex;align-items:center;gap:16px;padding:12px 20px;border-top:1px solid rgba(0,0,0,0.06);font-size:0.85rem;color:var(--gray);">
                        <span style="cursor:pointer;" onclick="showLikers('${postId}')"><i class="ph-fill ph-heart" style="color:#ef4444;"></i> ${likeCount} ${likeCount === 1 ? 'like' : 'likes'}</span>
                        <span style="cursor:pointer;" onclick="toggleComments('${postId}')"><i class="ph ph-chat-circle"></i> ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}</span>
                    </div>
                    <div style="display:flex;border-top:1px solid rgba(0,0,0,0.06);padding:8px 12px;">
                        <button onclick="toggleLike('${postId}')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;background:none;border:none;cursor:pointer;font-size:0.95rem;font-weight:600;color:${isLiked ? '#ef4444' : 'var(--gray)'};border-radius:10px;transition:all 0.2s;font-family:inherit;">
                            <i class="ph${isLiked ? '-fill' : ''} ph-heart" style="font-size:1.3rem;"></i>
                            <span>${isLiked ? 'Liked' : 'Like'}</span>
                        </button>
                        <button onclick="toggleComments('${postId}')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;background:none;border:none;cursor:pointer;font-size:0.95rem;font-weight:600;color:var(--gray);border-radius:10px;transition:all 0.2s;font-family:inherit;">
                            <i class="ph ph-chat-circle" style="font-size:1.3rem;"></i>
                            <span>Comment</span>
                        </button>
                    </div>
                    <div id="comments-${postId}" style="display:none;"></div>
                </div>`;
        });
    } catch (e) { console.error('Posts load error:', e); }
}

function formatPostTime(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.handlePostCreate = async function(e) {
    e.preventDefault();
    const user = requireAuthenticatedUser('create a post');
    if (!user) return;

    const content = document.getElementById('postContent').value.trim();
    const imageInput = document.getElementById('postImage');
    const imageFile = imageInput?.files[0];

    if (!content) {
        showNotification('Please write something to post.', 'error');
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.textContent = 'Publishing...'; btn.disabled = true;

    try {
        let imageUrl = '';

        if (imageFile) {
            const formData = new FormData();
            formData.append('file', imageFile);
            formData.append('upload_preset', CLOUDINARY.uploadPreset);
            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/auto/upload`, { method: 'POST', body: formData });
            const data = await res.json();
            imageUrl = data.secure_url;
        }

        await addDoc(collection(db, "posts"), {
            content,
            imageUrl,
            authorId: user.uid,
            authorName: user.displayName || user.email,
            authorPhoto: user.photoURL || '',
            likes: [],
            commentCount: 0,
            createdAt: serverTimestamp()
        });

        closeModal('uploadModal');
        e.target.reset();
        const label = document.getElementById('post-image-label');
        if (label) label.innerHTML = `<i class="ph ph-image" style="font-size:2rem;color:var(--primary);display:block;margin-bottom:8px;"></i><span style="font-size:0.9rem;color:var(--dark);font-weight:600;">Click to add an image</span>`;
        showNotification('Post published!', 'success');
        loadPosts();
    } catch (err) {
        showNotification('Failed to publish: ' + err.message, 'error');
    } finally {
        btn.innerHTML = '<i class="ph ph-paper-plane-tilt" style="margin-right:8px;"></i>Publish Post';
        btn.disabled = false;
    }
};

window.previewPostImage = function(input) {
    const label = document.getElementById('post-image-label');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            label.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:200px;border-radius:8px;margin-bottom:8px;"><span style="font-size:0.85rem;color:var(--primary);font-weight:600;">Click to change image</span>`;
        };
        reader.readAsDataURL(input.files[0]);
    }
};

window.toggleLike = async function(postId) {
    const user = requireAuthenticatedUser('like posts');
    if (!user) return;

    try {
        const postRef = doc(db, "posts", postId);
        const postSnap = await getDoc(postRef);
        if (!postSnap.exists()) return;

        const postData = postSnap.data();
        let likes = postData.likes || [];
        const isLiked = likes.includes(user.uid);

        if (isLiked) {
            likes = likes.filter(uid => uid !== user.uid);
        } else {
            likes.push(user.uid);
        }

        await updateDoc(postRef, { likes });
        loadPosts(); // Refresh to show updated like count
    } catch (err) {
        console.error('Like error:', err);
    }
};

window.toggleComments = async function(postId) {
    const section = document.getElementById(`comments-${postId}`);
    if (!section) return;

    if (section.style.display === 'none') {
        section.style.display = 'block';
        await loadComments(postId);
    } else {
        section.style.display = 'none';
    }
};

async function loadComments(postId) {
    const section = document.getElementById(`comments-${postId}`);
    section.innerHTML = '<p style="text-align:center;padding:20px;color:var(--gray);">Loading comments...</p>';

    try {
        const commentsSnap = await getDocs(query(
            collection(db, "posts", postId, "comments"),
            orderBy("createdAt", "asc")
        ));

        let commentsHTML = '';
        commentsSnap.forEach(c => {
            const comment = c.data();
            const timeAgo = formatPostTime(comment.createdAt?.toDate() || new Date());
            commentsHTML += `
                <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
                    <img style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;"
                         src="${comment.authorPhoto || 'https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'}"
                         onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                    <div style="flex:1;background:white;padding:10px 14px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                        <div style="font-weight:600;font-size:0.9rem;color:var(--dark);margin-bottom:4px;">${comment.authorName || 'Unknown'}</div>
                        <div style="font-size:0.9rem;color:var(--dark);line-height:1.5;">${escapeHtml(comment.text)}</div>
                        <div style="font-size:0.75rem;color:var(--gray);margin-top:6px;">${timeAgo}</div>
                    </div>
                </div>`;
        });

        if (!commentsHTML) {
            commentsHTML = '<p style="text-align:center;padding:20px;color:var(--gray);">No comments yet. Be the first!</p>';
        }

        section.innerHTML = `
            <div style="background:var(--light);padding:16px 20px;max-height:300px;overflow-y:auto;">${commentsHTML}</div>
            <div style="display:flex;gap:12px;padding:16px 20px;background:var(--light);border-top:1px solid rgba(0,0,0,0.06);">
                <input type="text" id="comment-input-${postId}" placeholder="Write a comment..." style="flex:1;padding:12px 16px;border:1px solid rgba(0,0,0,0.1);border-radius:24px;font-size:0.9rem;outline:none;font-family:inherit;" onkeypress="if(event.key==='Enter')addComment('${postId}')">
                <button onclick="addComment('${postId}')" style="padding:12px 20px;background:var(--gradient-primary);color:white;border:none;border-radius:24px;cursor:pointer;font-weight:600;font-size:0.9rem;font-family:inherit;">Post</button>
            </div>`;
    } catch (err) {
        section.innerHTML = '<p style="text-align:center;padding:20px;color:#ef4444;">Failed to load comments.</p>';
        console.error('Comments load error:', err);
    }
}

window.addComment = async function(postId) {
    const user = requireAuthenticatedUser('comment on posts');
    if (!user) return;

    const input = document.getElementById(`comment-input-${postId}`);
    const text = input.value.trim();
    if (!text) return;

    input.disabled = true;

    try {
        await addDoc(collection(db, "posts", postId, "comments"), {
            text,
            authorId: user.uid,
            authorName: user.displayName || user.email,
            authorPhoto: user.photoURL || '',
            createdAt: serverTimestamp()
        });

        // Update comment count
        const postRef = doc(db, "posts", postId);
        const postSnap = await getDoc(postRef);
        const currentCount = postSnap.data().commentCount || 0;
        await updateDoc(postRef, { commentCount: currentCount + 1 });

        input.value = '';
        await loadComments(postId);
        loadPosts(); // Refresh to show updated comment count
    } catch (err) {
        showNotification('Failed to add comment.', 'error');
        console.error('Comment error:', err);
    } finally {
        input.disabled = false;
    }
};

window.viewPostImage = function(url) {
    const modal = document.createElement('div');
    modal.className = 'modal-wrap';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div style="background:white;border-radius:20px;padding:20px;max-width:90vw;max-height:90vh;position:relative;">
            <button onclick="this.closest('.modal-wrap').remove()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.5);border:none;font-size:1.5rem;cursor:pointer;color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;">&times;</button>
            <img src="${url}" style="max-width:100%;max-height:80vh;border-radius:12px;display:block;">
        </div>`;
    document.body.appendChild(modal);
    modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };
};

window.showLikers = function(postId) {
    showNotification('Likes feature coming soon!', 'info');
};

// ════════════════════════════════════════════
//  MODALS
// ════════════════════════════════════════════
window.openModal = function(id) {
    const protectedAction = PROTECTED_MODAL_ACTIONS[id];
    if (protectedAction && !auth.currentUser) {
        requireAuthenticatedUser(protectedAction);
        return;
    }

    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (id === 'authModal') {
        toggleAuthMode('signin');
        document.getElementById('signinForm')?.reset();
        document.getElementById('signupForm')?.reset();
    }
};

window.closeModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) { modal.style.display = 'none'; document.body.style.overflow = 'auto'; }
};

window.onclick = function(e) {
    if (e.target.classList.contains('modal-wrap')) {
        e.target.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
};

// ════════════════════════════════════════════
//  SEARCH JOBS
// ════════════════════════════════════════════
window.filterJobs = function() {
    const val = document.getElementById('jobSearch')?.value.toLowerCase() || '';
    document.querySelectorAll('.job-card').forEach(card => {
        card.style.display = card.innerText.toLowerCase().includes(val) ? 'grid' : 'none';
    });
    document.getElementById('jobs')?.scrollIntoView({ behavior: 'smooth' });
};

// ════════════════════════════════════════════
//  NAVBAR SCROLL
// ════════════════════════════════════════════
window.addEventListener('scroll', () => {
    const nav = document.getElementById('navbar');
    if (!nav) return;
    if (window.scrollY > 50) {
        nav.style.padding = '12px 0'; nav.style.backdropFilter = 'blur(25px)';
        nav.style.background = 'rgba(255,255,255,0.96)'; nav.style.boxShadow = '0 5px 30px rgba(0,0,0,0.08)';
    } else {
        nav.style.padding = '18px 0'; nav.style.background = 'rgba(255,255,255,0.92)'; nav.style.boxShadow = 'none';
    }
});

// ════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════
function getStatusBadge(status) {
    const map = {
        pending:  `<span class="status-badge pending"><i class="ph ph-clock"></i> Pending</span>`,
        accepted: `<span class="status-badge accepted"><i class="ph ph-check-circle"></i> Accepted</span>`,
        rejected: `<span class="status-badge rejected"><i class="ph ph-x-circle"></i> Rejected</span>`
    };
    return map[status] || map['pending'];
}

function formatTimeAgo(timestamp) {
    if (!timestamp?.toDate) return 'recently';
    const seconds = Math.floor((new Date() - timestamp.toDate()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
    return `${Math.floor(seconds/86400)}d ago`;
}

function initCounters() {
    document.querySelectorAll('.stat-item h3').forEach(el => {
        const target = parseInt(el.innerText);
        if (isNaN(target)) return;
        const step = target / 50;
        let current = 0;
        const tick = () => {
            if (current < target) { current += step; el.innerText = Math.ceil(current) + '+'; setTimeout(tick, 30); }
            else el.innerText = target + '+';
        };
        new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { tick(); } }).observe(el.parentElement);
    });
}

function showNotification(message, type = 'success') {
    const colors = { success:'#10b981', error:'#ef4444', info:'#3b82f6', warning:'#f59e0b' };
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;top:100px;right:30px;background:${colors[type]};color:white;padding:15px 25px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.15);z-index:99999;font-weight:500;display:flex;align-items:center;gap:10px;max-width:360px;font-family:inherit;`;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => { n.style.opacity='0'; n.style.transition='opacity 0.3s'; setTimeout(() => n.remove(), 300); }, 4000);
}

// ════════════════════════════════════════════
//  NETWORK — SEARCH, CONNECTIONS, DIRECT CHAT
// ════════════════════════════════════════════

// ── Helper: deterministic DM chatId ──
function getDirectChatId(uid1, uid2) {
    return uid1 < uid2 ? `dm_${uid1}_${uid2}` : `dm_${uid2}_${uid1}`;
}

// ── Tab Switching ──
window.switchNetworkTab = function(tabId) {
    document.querySelectorAll('.network-panel').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.network-tab').forEach(t => t.classList.remove('active'));
    const panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'block';
    const tab = document.querySelector(`.network-tab[data-tab="${tabId}"]`);
    if (tab) tab.classList.add('active');
};

// ── Search Users ──
window.searchUsers = async function() {
    const user = auth.currentUser;
    const input = document.getElementById('networkSearch');
    const container = document.getElementById('search-results');
    if (!input || !container) return;

    const searchTerm = input.value.trim().toLowerCase();
    if (!searchTerm) {
        showNotification('Please enter a name to search.', 'info');
        return;
    }

    switchNetworkTab('search-results');
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--gray);"><i class="ph ph-spinner" style="font-size:2rem;"></i><p style="margin-top:10px;">Searching...</p></div>`;

    try {
        const snap = await getDocs(collection(db, "users"));
        const results = [];
        snap.forEach(d => {
            const u = d.data();
            if (user && u.uid === user.uid) return;
            if (u.name && u.name.toLowerCase().includes(searchTerm)) {
                results.push(u);
            }
        });

        if (results.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);"><i class="ph ph-magnifying-glass" style="font-size:4rem;margin-bottom:20px;display:block;opacity:0.4;"></i><p>No users found matching "${input.value.trim()}"</p></div>`;
            return;
        }

        let connectionMap = {};
        if (user) {
            const sentSnap = await getDocs(query(collection(db, "connections"), where("from", "==", user.uid)));
            sentSnap.forEach(d => {
                const c = d.data();
                connectionMap[c.to] = { status: c.status, direction: 'sent', docId: d.id };
            });
            const recvSnap = await getDocs(query(collection(db, "connections"), where("to", "==", user.uid)));
            recvSnap.forEach(d => {
                const c = d.data();
                connectionMap[c.from] = { status: c.status, direction: 'received', docId: d.id };
            });
        }

        container.innerHTML = '';
        results.forEach(u => {
            const photo = u.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name||'User')}&background=6366f1&color=fff`;
            const roleBadge = u.role === 'company'
                ? `<span style="padding:3px 10px;background:rgba(167,139,250,0.15);color:#7c3aed;border-radius:20px;font-size:0.72rem;font-weight:600;">Company</span>`
                : `<span style="padding:3px 10px;background:rgba(99,102,241,0.15);color:#6366f1;border-radius:20px;font-size:0.72rem;font-weight:600;">Job Seeker</span>`;

            let actionBtn = '';
            if (!user) {
                actionBtn = `<button class="btn-connect" onclick="requireAuthenticatedUser('connect with people')">Connect</button>`;
            } else {
                const conn = connectionMap[u.uid];
                if (!conn) {
                    actionBtn = `<button class="btn-connect" onclick="sendConnectionRequest('${u.uid}','${(u.name||'').replace(/'/g,"\\'")}','${(photo||'').replace(/'/g,"\\'")}')"><i class="ph ph-user-plus"></i> Connect</button>`;
                } else if (conn.status === 'pending' && conn.direction === 'sent') {
                    actionBtn = `<button class="btn-pending-out"><i class="ph ph-clock"></i> Pending</button>`;
                } else if (conn.status === 'pending' && conn.direction === 'received') {
                    actionBtn = `<button class="btn-accept" onclick="acceptConnection('${conn.docId}')"><i class="ph ph-check"></i> Accept</button>`;
                } else if (conn.status === 'accepted') {
                    actionBtn = `<button class="chat-open-btn" onclick="openDirectChat('${u.uid}','${(u.name||'').replace(/'/g,"\\'")}')"><i class="ph ph-chat-circle-dots"></i> Message</button>`;
                }
            }

            container.innerHTML += `
                <div class="network-card">
                    <img class="nc-avatar" src="${photo}" alt="${u.name}" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                    <div class="nc-info">
                        <h4>${u.name} ${roleBadge}</h4>
                        <p>${u.email}</p>
                    </div>
                    <div class="nc-actions">
                        <button class="btn-view-profile" onclick="viewUserProfile('${u.uid}')"><i class="ph ph-eye"></i> Profile</button>
                        ${actionBtn}
                    </div>
                </div>`;
        });
    } catch (e) {
        console.error('Search error:', e);
        container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--gray);">Search failed. Please try again.</div>`;
    }
};

// ── Send Connection Request ──
window.sendConnectionRequest = async function(toUid, toName, toPhoto) {
    const user = requireAuthenticatedUser('send connection requests');
    if (!user) return;

    try {
        const q1 = query(collection(db, "connections"), where("from", "==", user.uid), where("to", "==", toUid));
        const q2 = query(collection(db, "connections"), where("from", "==", toUid), where("to", "==", user.uid));
        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);

        if (!snap1.empty || !snap2.empty) {
            showNotification('Connection request already exists.', 'info');
            return;
        }

        await addDoc(collection(db, "connections"), {
            from:      user.uid,
            to:        toUid,
            fromName:  user.displayName || user.email.split('@')[0],
            fromPhoto: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||'User')}&background=6366f1&color=fff`,
            toName:    toName,
            toPhoto:   toPhoto,
            status:    'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        showNotification(`Connection request sent to ${toName}!`, 'success');
        searchUsers();
        loadSentRequests(user.uid);
    } catch (e) {
        console.error('Connection request error:', e);
        showNotification('Failed to send connection request.', 'error');
    }
};

// ── Accept Connection Request ──
window.acceptConnection = async function(connectionId) {
    const user = requireAuthenticatedUser('accept connections');
    if (!user) return;

    try {
        const connRef = doc(db, "connections", connectionId);
        const connSnap = await getDoc(connRef);
        if (!connSnap.exists()) {
            showNotification('Connection request not found.', 'error');
            return;
        }
        const connData = connSnap.data();
        if (connData.to !== user.uid) {
            showNotification('You can only accept requests sent to you.', 'error');
            return;
        }

        await updateDoc(connRef, { status: 'accepted', updatedAt: serverTimestamp() });
        showNotification(`You are now connected with ${connData.fromName}!`, 'success');
        loadPendingRequests(user.uid);
        loadMyConnections(user.uid);
    } catch (e) {
        showNotification('Failed to accept connection.', 'error');
    }
};

// ── Reject Connection Request ──
window.rejectConnection = async function(connectionId) {
    const user = requireAuthenticatedUser('manage connections');
    if (!user) return;

    try {
        const connRef = doc(db, "connections", connectionId);
        const connSnap = await getDoc(connRef);
        if (!connSnap.exists()) return;
        if (connSnap.data().to !== user.uid) {
            showNotification('You can only decline requests sent to you.', 'error');
            return;
        }
        await deleteDoc(connRef);
        showNotification('Connection request declined.', 'info');
        loadPendingRequests(user.uid);
    } catch (e) {
        showNotification('Failed to decline connection.', 'error');
    }
};

// ── Cancel Sent Connection Request ──
window.cancelConnectionRequest = async function(connectionId) {
    const user = requireAuthenticatedUser('manage connections');
    if (!user) return;

    try {
        const connRef = doc(db, "connections", connectionId);
        const connSnap = await getDoc(connRef);
        if (!connSnap.exists()) return;
        if (connSnap.data().from !== user.uid) {
            showNotification('You can only cancel your own requests.', 'error');
            return;
        }
        await deleteDoc(connRef);
        showNotification('Connection request cancelled.', 'info');
        loadSentRequests(user.uid);
    } catch (e) {
        showNotification('Failed to cancel request.', 'error');
    }
};

// ── Remove Existing Connection ──
window.removeConnection = async function(connectionId, otherName) {
    const user = requireAuthenticatedUser('manage connections');
    if (!user) return;
    if (!confirm(`Remove ${otherName} from your connections?`)) return;

    try {
        await deleteDoc(doc(db, "connections", connectionId));
        showNotification(`Removed ${otherName} from connections.`, 'info');
        loadMyConnections(user.uid);
    } catch (e) {
        showNotification('Failed to remove connection.', 'error');
    }
};

// ── Load My Connections (accepted) ──
function loadMyConnections(uid) {
    const container = document.getElementById('my-connections');
    if (!container) return;

    const q1 = query(collection(db, "connections"), where("from", "==", uid), where("status", "==", "accepted"));
    const q2 = query(collection(db, "connections"), where("to", "==", uid), where("status", "==", "accepted"));

    Promise.all([getDocs(q1), getDocs(q2)]).then(([snap1, snap2]) => {
        const connections = [];
        snap1.forEach(d => {
            const c = d.data();
            connections.push({ uid: c.to, name: c.toName, photo: c.toPhoto, docId: d.id });
        });
        snap2.forEach(d => {
            const c = d.data();
            connections.push({ uid: c.from, name: c.fromName, photo: c.fromPhoto, docId: d.id });
        });

        const countEl = document.getElementById('connections-count');
        if (countEl) countEl.textContent = connections.length > 0 ? connections.length : '';

        if (connections.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);"><i class="ph ph-user-circle" style="font-size:4rem;margin-bottom:20px;display:block;opacity:0.4;"></i><p>No connections yet. Search for people to connect with!</p></div>`;
            return;
        }

        container.innerHTML = '';
        connections.forEach(c => {
            const photo = c.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name||'User')}&background=6366f1&color=fff`;
            container.innerHTML += `
                <div class="network-card">
                    <img class="nc-avatar" src="${photo}" alt="${c.name}" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                    <div class="nc-info">
                        <h4>${c.name}</h4>
                        <p><span class="status-badge accepted" style="font-size:0.72rem;padding:3px 10px;"><i class="ph ph-check-circle"></i> Connected</span></p>
                    </div>
                    <div class="nc-actions">
                        <button class="btn-view-profile" onclick="viewUserProfile('${c.uid}')"><i class="ph ph-eye"></i> Profile</button>
                        <button class="chat-open-btn" onclick="openDirectChat('${c.uid}','${(c.name||'').replace(/'/g,"\\'")}')"><i class="ph ph-chat-circle-dots"></i> Message</button>
                        <button onclick="removeConnection('${c.docId}','${(c.name||'').replace(/'/g,"\\'")}')" style="padding:8px 14px;border-radius:20px;border:none;background:rgba(239,68,68,0.1);color:#dc2626;font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;"><i class="ph ph-user-minus"></i> Remove</button>
                    </div>
                </div>`;
        });
    });
}

// ── Load Pending Incoming Requests ──
function loadPendingRequests(uid) {
    const container = document.getElementById('pending-requests');
    if (!container) return;

    getDocs(query(collection(db, "connections"), where("to", "==", uid), where("status", "==", "pending"))).then(snap => {
        const countEl = document.getElementById('requests-count');
        if (countEl) countEl.textContent = snap.size > 0 ? snap.size : '';

        if (snap.empty) {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);"><i class="ph ph-clock" style="font-size:4rem;margin-bottom:20px;display:block;opacity:0.4;"></i><p>No pending connection requests</p></div>`;
            return;
        }

        container.innerHTML = '';
        snap.forEach(d => {
            const c = d.data();
            const photo = c.fromPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.fromName||'User')}&background=6366f1&color=fff`;
            container.innerHTML += `
                <div class="network-card">
                    <img class="nc-avatar" src="${photo}" alt="${c.fromName}" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                    <div class="nc-info">
                        <h4>${c.fromName}</h4>
                        <p>Wants to connect &nbsp;&middot;&nbsp; ${formatTimeAgo(c.createdAt)}</p>
                    </div>
                    <div class="nc-actions">
                        <button class="btn-view-profile" onclick="viewUserProfile('${c.from}')"><i class="ph ph-eye"></i> Profile</button>
                        <button class="btn-accept" onclick="acceptConnection('${d.id}')"><i class="ph ph-check"></i> Accept</button>
                        <button class="btn-reject" onclick="rejectConnection('${d.id}')"><i class="ph ph-x"></i> Decline</button>
                    </div>
                </div>`;
        });
    });
}

// ── Load Sent Requests ──
function loadSentRequests(uid) {
    const container = document.getElementById('sent-requests');
    if (!container) return;

    getDocs(query(collection(db, "connections"), where("from", "==", uid), where("status", "==", "pending"))).then(snap => {
        if (snap.empty) {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);"><i class="ph ph-paper-plane-tilt" style="font-size:4rem;margin-bottom:20px;display:block;opacity:0.4;"></i><p>No pending sent requests</p></div>`;
            return;
        }

        container.innerHTML = '';
        snap.forEach(d => {
            const c = d.data();
            const photo = c.toPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.toName||'User')}&background=6366f1&color=fff`;
            container.innerHTML += `
                <div class="network-card">
                    <img class="nc-avatar" src="${photo}" alt="${c.toName}" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                    <div class="nc-info">
                        <h4>${c.toName}</h4>
                        <p><span class="status-badge pending" style="font-size:0.72rem;padding:3px 10px;"><i class="ph ph-clock"></i> Pending</span> &nbsp;&middot;&nbsp; Sent ${formatTimeAgo(c.createdAt)}</p>
                    </div>
                    <div class="nc-actions">
                        <button class="btn-view-profile" onclick="viewUserProfile('${c.to}')"><i class="ph ph-eye"></i> Profile</button>
                        <button onclick="cancelConnectionRequest('${d.id}')" style="padding:8px 14px;border-radius:20px;border:none;background:rgba(239,68,68,0.1);color:#dc2626;font-size:0.85rem;font-weight:600;cursor:pointer;font-family:inherit;"><i class="ph ph-x"></i> Cancel</button>
                    </div>
                </div>`;
        });
    });
}

// ── View User Profile (modal) ──
window.viewUserProfile = async function(uid) {
    const content = document.getElementById('profile-view-content');
    if (!content) return;
    openModal('viewProfileModal');
    content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--gray);"><i class="ph ph-spinner" style="font-size:2rem;"></i><p style="margin-top:10px;">Loading profile...</p></div>`;

    try {
        // Fetch user data and posts separately to avoid composite index requirement
        const [userSnap, profSnap] = await Promise.all([
            getDoc(doc(db, "users", uid)),
            getDoc(doc(db, "userProfiles", uid))
        ]);

        if (!userSnap.exists()) {
            content.innerHTML = `<p style="text-align:center;color:var(--gray);padding:40px;">User not found.</p>`;
            return;
        }

        // Fetch posts for this user (simple where query, no orderBy to avoid index)
        let userPosts = [];
        try {
            const postsSnap = await getDocs(query(collection(db, "posts"), where("authorId", "==", uid)));
            userPosts = postsSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(p => !p.deleted)
                .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        } catch (postsErr) {
            console.log('Posts query failed, showing empty:', postsErr);
        }

        const u = userSnap.data();
        const p = profSnap.exists() ? profSnap.data() : {};
        const photo = p.photoUrl || u.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name||'User')}&background=6366f1&color=fff`;
        const roleBadge = u.role === 'company'
            ? `<span style="padding:4px 12px;background:rgba(167,139,250,0.15);color:#7c3aed;border-radius:20px;font-size:0.75rem;font-weight:600;">Company</span>`
            : `<span style="padding:4px 12px;background:rgba(99,102,241,0.15);color:#6366f1;border-radius:20px;font-size:0.75rem;font-weight:600;">Job Seeker</span>`;

        // Connection status
        let actionBtn = '';
        const currentUser = auth.currentUser;
        if (currentUser && currentUser.uid !== uid) {
            const [s1, s2] = await Promise.all([
                getDocs(query(collection(db, "connections"), where("from","==",currentUser.uid), where("to","==",uid))),
                getDocs(query(collection(db, "connections"), where("from","==",uid), where("to","==",currentUser.uid)))
            ]);
            let connStatus = null, connDirection = null, connDocId = null;
            if (!s1.empty) { connStatus = s1.docs[0].data().status; connDirection = 'sent'; connDocId = s1.docs[0].id; }
            else if (!s2.empty) { connStatus = s2.docs[0].data().status; connDirection = 'received'; connDocId = s2.docs[0].id; }
            if (!connStatus) actionBtn = `<button class="btn-connect" onclick="sendConnectionRequest('${uid}','${(u.name||'').replace(/'/g,"\'")}','${photo.replace(/'/g,"\'")}');closeModal('viewProfileModal');"><i class="ph ph-user-plus"></i> Connect</button>`;
            else if (connStatus==='pending'&&connDirection==='sent') actionBtn = `<button class="btn-pending-out"><i class="ph ph-clock"></i> Request Pending</button>`;
            else if (connStatus==='pending'&&connDirection==='received') actionBtn = `<button class="btn-accept" onclick="acceptConnection('${connDocId}');closeModal('viewProfileModal');"><i class="ph ph-check"></i> Accept Request</button>`;
            else if (connStatus==='accepted') actionBtn = `<button class="chat-open-btn" onclick="openDirectChat('${uid}','${(u.name||'').replace(/'/g,"\'")}');closeModal('viewProfileModal');"><i class="ph ph-chat-circle-dots"></i> Message</button>`;
        }

        const section = (icon, title, html) => html ? `<div style="background:#f8fafc;border-radius:14px;padding:18px 20px;margin-bottom:16px;"><h4 style="font-size:0.95rem;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;color:var(--dark);"><i class="${icon}" style="color:var(--primary);"></i>${title}</h4>${html}</div>` : '';
        const field = (label, val) => val ? `<div style="margin-bottom:10px;"><span style="font-size:0.78rem;color:var(--gray);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${label}</span><p style="font-size:0.9rem;color:var(--dark);margin-top:2px;">${val}</p></div>` : '';
        const grid2 = (...fields) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">${fields.join('')}</div>`;

        const skillsHTML = p.skills ? p.skills.split(',').map(s=>s.trim()).filter(Boolean).map(s=>`<span style="padding:4px 12px;background:rgba(99,102,241,0.1);color:var(--primary);border-radius:20px;font-size:0.8rem;font-weight:600;">${s}</span>`).join('') : '';
        const hobbiesHTML = p.hobbies ? p.hobbies.split(',').map(s=>s.trim()).filter(Boolean).map(s=>`<span style="padding:4px 12px;background:rgba(251,191,36,0.1);color:#d97706;border-radius:20px;font-size:0.8rem;font-weight:600;">${s}</span>`).join('') : '';
        const socials = [
            p.linkedin ? `<a href="${p.linkedin}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:rgba(10,102,194,0.1);color:#0a66c2;border-radius:20px;font-size:0.85rem;font-weight:600;text-decoration:none;"><i class="ph ph-linkedin-logo"></i>LinkedIn</a>` : '',
            p.github ? `<a href="${p.github}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:rgba(0,0,0,0.08);color:#1e293b;border-radius:20px;font-size:0.85rem;font-weight:600;text-decoration:none;"><i class="ph ph-github-logo"></i>GitHub</a>` : '',
            p.portfolio ? `<a href="${p.portfolio}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:rgba(99,102,241,0.1);color:var(--primary);border-radius:20px;font-size:0.85rem;font-weight:600;text-decoration:none;"><i class="ph ph-globe"></i>Portfolio</a>` : ''
        ].filter(Boolean).join('');
        const resumeHTML = p.resumeUrl ? `<a href="${p.resumeUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:10px;padding:12px 20px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;text-decoration:none;color:#059669;font-weight:600;font-size:0.9rem;"><i class="ph-fill ph-file-pdf" style="font-size:1.5rem;"></i><div><div>${p.resumeFileName||'Resume.pdf'}</div><small style="font-weight:400;opacity:0.7;">Click to view / download</small></div><i class="ph ph-arrow-square-out" style="margin-left:auto;"></i></a>` : '<p style="color:var(--gray);font-size:0.9rem;">No resume uploaded yet.</p>';

        // Build posts HTML
        const postsHTML = userPosts.length === 0
            ? `<p style="color:var(--gray);text-align:center;padding:20px;">No posts yet.</p>`
            : `<div style="display:flex;flex-direction:column;gap:12px;">${userPosts.slice(0, 5).map(post => {
                const likeCount = post.likes ? post.likes.length : 0;
                const commentCount = post.commentCount || 0;
                const timeAgo = formatPostTime(post.createdAt?.toDate() || new Date());
                const contentPreview = post.content.length > 100 ? post.content.substring(0, 100) + '...' : post.content;
                return `
                    <div style="background:white;border-radius:12px;padding:14px;border:1px solid rgba(0,0,0,0.06);cursor:pointer;" onclick="closeModal('viewProfileModal');document.getElementById('posts').scrollIntoView({behavior:'smooth'});">
                        ${post.imageUrl ? `<img style="width:100%;height:80px;object-fit:cover;border-radius:8px;margin-bottom:10px;" src="${post.imageUrl}" alt="Post">` : ''}
                        <div style="font-size:0.9rem;color:var(--dark);line-height:1.5;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(contentPreview)}</div>
                        <div style="display:flex;gap:12px;font-size:0.8rem;color:var(--gray);">
                            <span><i class="ph-fill ph-heart" style="color:#ef4444;"></i> ${likeCount}</span>
                            <span><i class="ph ph-chat-circle"></i> ${commentCount}</span>
                            <span style="margin-left:auto;"><i class="ph ph-clock"></i> ${timeAgo}</span>
                        </div>
                    </div>`;
            }).join('')}</div>`;

        content.innerHTML = `
            <div style="text-align:center;padding:24px 0 20px;border-bottom:1px solid #e2e8f0;margin-bottom:20px;">
                <img src="${photo}" style="width:90px;height:90px;border-radius:50%;object-fit:cover;border:3px solid var(--primary);margin-bottom:12px;" onerror="this.src='https://ui-avatars.com/api/?name=User&background=6366f1&color=fff'">
                <h3 style="font-size:1.4rem;margin-bottom:4px;">${p.fullName||u.name} ${roleBadge}</h3>
                ${p.jobTitle?`<p style="color:var(--primary);font-weight:600;font-size:0.95rem;margin-bottom:4px;">${p.jobTitle}</p>`:''}
                ${p.location?`<p style="color:var(--gray);font-size:0.85rem;margin-bottom:4px;"><i class="ph ph-map-pin"></i> ${p.location}</p>`:''}
                ${p.bio?`<p style="color:var(--dark);font-size:0.9rem;max-width:500px;margin:10px auto 0;line-height:1.6;">${p.bio}</p>`:''}
                <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">${actionBtn}</div>
            </div>
            ${section('ph ph-user-circle','Personal Information', grid2(field('Phone',p.phone),field('Date of Birth',p.dob),field('Gender',p.gender),field('Nationality',p.nationality)))}
            ${section('ph ph-briefcase','Professional Details', grid2(field('Experience',p.experience),field('Expected Salary',p.salary),field('Work Type',p.workType)) + (skillsHTML?`<div style="margin-top:12px;"><p style="font-size:0.78rem;color:var(--gray);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Skills</p><div style="display:flex;flex-wrap:wrap;gap:8px;">${skillsHTML}</div></div>`:''))}
            ${section('ph ph-graduation-cap','Education', grid2(field('Degree',p.degree),field('Institution',p.institution),field('Year',p.gradYear),field('GPA / Marks',p.marks)) + (p.certifications?`<div style="margin-top:10px;">${field('Certifications',p.certifications)}</div>`:''))}
            ${hobbiesHTML ? section('ph ph-smiley','Hobbies & Interests',`<div style="display:flex;flex-wrap:wrap;gap:8px;">${hobbiesHTML}</div>`) : ''}
            ${section('ph ph-file-pdf','Resume / CV', resumeHTML)}
            ${socials ? section('ph ph-share-network','Social & Portfolio',`<div style="display:flex;gap:10px;flex-wrap:wrap;">${socials}</div>`) : ''}
            ${section('ph ph-article','Posts', postsHTML)}
        `;
    } catch(e) {
        console.error('Profile load error:', e);
        content.innerHTML = `<p style="text-align:center;color:var(--gray);padding:40px;">Failed to load profile.</p>`;
    }
};
// ── Open Direct Chat with Connection ──
window.openDirectChat = function(otherUid, otherName) {
    const user = requireAuthenticatedUser('chat');
    if (!user) return;

    const chatId = getDirectChatId(user.uid, otherUid);
    closeChat();
    window._chatCurrentUid = user.uid;

    getDoc(doc(db, "users", otherUid)).then(snap => {
        const other = snap.exists() ? snap.data() : { name: otherName || 'Unknown', photo: '' };
        renderChatBox(chatId, 'Direct Message', other, user);
        subscribeToChatMessages(chatId, user.uid);
    });
};

// ── Network search Enter key listener ──
document.addEventListener('DOMContentLoaded', () => {
    const nsInput = document.getElementById('networkSearch');
    if (nsInput) {
        nsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') searchUsers();
        });
    }
});


// ════════════════════════════════════════════
//  USER PROFILE — CREATE / EDIT / SAVE
// ════════════════════════════════════════════

window.openEditProfileModal = async function() {
    const user = requireAuthenticatedUser('edit your profile');
    if (!user) return;
    openModal('editProfileModal');

    // Pre-fill photo from auth
    const photo = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||'User')}&background=6366f1&color=fff`;
    const photoEl = document.getElementById('profilePhotoPreview');
    if (photoEl) photoEl.src = photo;

    // Load existing profile data
    try {
        const snap = await getDoc(doc(db, "userProfiles", user.uid));
        if (!snap.exists()) return;
        const p = snap.data();

        const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val || ''; };
        if (p.photoUrl && photoEl) photoEl.src = p.photoUrl;
        set('prof_fullName', p.fullName);
        set('prof_phone', p.phone);
        set('prof_dob', p.dob);
        set('prof_gender', p.gender);
        set('prof_location', p.location);
        set('prof_nationality', p.nationality);
        set('prof_bio', p.bio);
        set('prof_jobTitle', p.jobTitle);
        set('prof_experience', p.experience);
        set('prof_salary', p.salary);
        set('prof_workType', p.workType);
        set('prof_skills', p.skills);
        set('prof_hobbies', p.hobbies);
        set('prof_degree', p.degree);
        set('prof_institution', p.institution);
        set('prof_gradYear', p.gradYear);
        set('prof_marks', p.marks);
        set('prof_certifications', p.certifications);
        set('prof_linkedin', p.linkedin);
        set('prof_github', p.github);
        set('prof_portfolio', p.portfolio);

        // Show existing resume
        if (p.resumeUrl) {
            const display = document.getElementById('current-resume-display');
            const nameEl  = document.getElementById('current-resume-name');
            const linkEl  = document.getElementById('current-resume-link');
            if (display) display.style.display = 'flex';
            if (nameEl) nameEl.textContent = p.resumeFileName || 'resume.pdf';
            if (linkEl) { linkEl.href = p.resumeUrl; }
        }
    } catch(e) { console.error('Load profile error:', e); }
};

window.saveUserProfile = async function(e) {
    e.preventDefault();
    const user = requireAuthenticatedUser('save profile');
    if (!user) return;

    const btn = document.getElementById('saveProfileBtn');
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

    try {
        const get = (id) => document.getElementById(id)?.value?.trim() || '';

        // Upload new photo if selected
        let photoUrl = null;
        const photoFile = document.getElementById('profilePhotoInput')?.files[0];
        if (photoFile) {
            const fd = new FormData();
            fd.append('file', photoFile);
            fd.append('upload_preset', CLOUDINARY.uploadPreset);
            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/auto/upload`, { method:'POST', body:fd });
            const data = await res.json();
            photoUrl = data.secure_url;
        }

        // Upload new resume if selected
        let resumeUrl = null, resumeFileName = null;
        const resumeFile = document.getElementById('profileResumeInput')?.files[0];
        if (resumeFile) {
            const fd = new FormData();
            fd.append('file', resumeFile);
            fd.append('upload_preset', CLOUDINARY.uploadPreset);
            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/auto/upload`, { method:'POST', body:fd });
            const data = await res.json();
            resumeUrl = data.secure_url;
            resumeFileName = resumeFile.name;
        }

        // Build profile object
        const profileData = {
            uid: user.uid,
            email: user.email,
            fullName:       get('prof_fullName'),
            phone:          get('prof_phone'),
            dob:            get('prof_dob'),
            gender:         get('prof_gender'),
            location:       get('prof_location'),
            nationality:    get('prof_nationality'),
            bio:            get('prof_bio'),
            jobTitle:       get('prof_jobTitle'),
            experience:     get('prof_experience'),
            salary:         get('prof_salary'),
            workType:       get('prof_workType'),
            skills:         get('prof_skills'),
            hobbies:        get('prof_hobbies'),
            degree:         get('prof_degree'),
            institution:    get('prof_institution'),
            gradYear:       get('prof_gradYear'),
            marks:          get('prof_marks'),
            certifications: get('prof_certifications'),
            linkedin:       get('prof_linkedin'),
            github:         get('prof_github'),
            portfolio:      get('prof_portfolio'),
            updatedAt:      serverTimestamp()
        };
        if (photoUrl) profileData.photoUrl = photoUrl;
        if (resumeUrl) { profileData.resumeUrl = resumeUrl; profileData.resumeFileName = resumeFileName; }

        await setDoc(doc(db, "userProfiles", user.uid), profileData, { merge: true });

        // Also update display name in users collection
        if (profileData.fullName) {
            await setDoc(doc(db, "users", user.uid), { name: profileData.fullName, photo: photoUrl || user.photoURL }, { merge: true });
        }

        showNotification('Profile saved successfully! ✅', 'success');
        closeModal('editProfileModal');
    } catch(e) {
        console.error('Save profile error:', e);
        showNotification('Failed to save profile: ' + e.message, 'error');
    } finally {
        if (btn) { btn.textContent = 'Save Profile'; btn.disabled = false; }
    }
};


// ── Dynamic styles injected ──
const style = document.createElement('style');
style.textContent = `
    .auth-toggle.active { background: white !important; box-shadow: 0 2px 8px rgba(0,0,0,0.1); color: var(--primary) !important; }
    .switch-role-btn { background:transparent;border:1px solid var(--primary);color:var(--primary);padding:8px 16px;border-radius:50px;font-size:0.85rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;transition:all 0.3s;font-family:inherit; }
    .switch-role-btn:hover { background:rgba(99,102,241,0.1); }
    .application-card { background:white;border-radius:16px;padding:20px 24px;border:1px solid #e2e8f0;margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap; }
    .application-card .job-icon { width:50px;height:50px;background:linear-gradient(135deg,#e0e7ff,#c7d2fe);border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--primary);font-size:1.4rem;flex-shrink:0; }
    .application-card .app-info { flex:1; }
    .application-card .app-info h4 { font-size:1rem;margin-bottom:4px; }
    .application-card .app-info p { color:var(--gray);font-size:0.85rem; }
`;
document.head.appendChild(style);