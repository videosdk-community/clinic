import wordmark from '../assets/videosdk-wordmark-black.svg'

/* "videosdk | Clinic" above the centred cards a person lands on first: the
   doctor's sign-in and the patient's front door. */
export function BrandLockup() {
  return (
    <div className="flex items-center gap-3">
      <img src={wordmark} alt="VideoSDK" className="h-5" />
      <div className="h-5 w-px bg-line" />
      <span className="text-lg font-medium text-ink">Clinic</span>
    </div>
  )
}
