import { useState } from 'react';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

export default function PasswordInput({ className = '', ...props }) {
  const [visible, setVisible] = useState(false);
  return <div className="relative"><input {...props} type={visible ? 'text' : 'password'} className={`${className} pr-10`} /><button type="button" onClick={() => setVisible((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-gray-500" aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}</button></div>;
}
