import 'server-only';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function createAdminDb() {
  try {
    if (getApps().length === 0) {
      const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

      if (serviceAccountKey) {
        initializeApp({
          credential: cert(JSON.parse(serviceAccountKey)),
        });
      } else {
        // Application Default Credentials (Cloud Run, local dev with gcloud auth)
        // projectId must be explicit — ADC alone doesn't set it in all environments.
        initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'urban-explorer-483600' });
      }
    }

    return getFirestore(getApps()[0], 'urbanexplorer');
  } catch (error) {
    console.error('[firebaseAdmin] CRITICAL: Failed to initialize Firebase Admin:', error);
    throw error;
  }
}

export const adminDb = createAdminDb();
